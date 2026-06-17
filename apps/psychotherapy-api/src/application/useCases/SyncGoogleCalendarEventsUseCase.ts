import { injectable, inject } from 'tsyringe';
import { google } from 'googleapis';
import { IPsychotherapyRepository, GoogleOAuthTokens } from '../../domain/repositories/IPsychotherapyRepository';
import { GoogleCalendarService } from '../../infrastructure/google/GoogleCalendarService';
import { PsychotherapyPatient } from '../../domain/models/PsychotherapyPatient';
import { AppointmentStatus, RecurrenceType } from '../../domain/models/PsychotherapyAppointment';
import { logger } from '../../infrastructure/logger';
import { PASTORAL_SENTINEL_EMAIL, PASTORAL_SUMMARY_PREFIX, PASTORAL_TITLE_REGEX } from '../../domain/constants/pastoral';

@injectable()
export class SyncGoogleCalendarEventsUseCase {
    constructor(
        @inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository,
        @inject('GoogleCalendarService') private readonly googleCalendar: GoogleCalendarService
    ) {}

    private isPastoralEvent(summary: string): boolean {
        return PASTORAL_TITLE_REGEX.test(summary.trim());
    }

    private extractPastoralTitle(summary: string): string {
        const cleaned = summary.trim().replace(PASTORAL_TITLE_REGEX, '').trim();
        return cleaned || 'Compromisso Pastoral';
    }

    private async findOrCreatePastoralPatient(
        config: GoogleOAuthTokens,
        patients: PsychotherapyPatient[]
    ): Promise<PsychotherapyPatient> {
        let patient = patients.find(p => p.email === PASTORAL_SENTINEL_EMAIL);
        if (!patient) {
            patient = await this.repository.savePatient({
                tenantId: config.tenantId,
                name: 'Atendimento Pastoral',
                status: 'inactive',
                paymentType: null,
                defaultSessionPriceCents: null,
                phone: null,
                email: PASTORAL_SENTINEL_EMAIL,
                reminderChannel: 'none'
            });
            patients.push(patient);
            logger.info({ tenantId: config.tenantId, patientId: patient.id }, '⛪ Paciente virtual "Atendimento Pastoral" criado');
        }
        return patient;
    }

    private resolveNotes(patient: PsychotherapyPatient, event: any): string | null {
        if (patient.email === PASTORAL_SENTINEL_EMAIL) {
            return `${PASTORAL_SUMMARY_PREFIX}${this.extractPastoralTitle(event.summary ?? '')}`;
        }
        return event.description ?? null;
    }

    async execute(): Promise<void> {
        logger.info('🔄 Iniciando ciclo de sincronização de eventos do Google Calendar para o app...');
        try {
            const configs = await this.repository.listAllGoogleOAuthTokens();
            logger.info(`📅 Encontrados ${configs.length} tenants com Google Calendar conectado.`);

            for (const config of configs) {
                try {
                    await this.syncTenantEvents(config);
                } catch (tenantErr) {
                    logger.error({ err: tenantErr, tenantId: config.tenantId }, 'Erro ao sincronizar eventos para o tenant');
                }
            }
        } catch (err) {
            logger.error({ err }, 'Erro ao carregar tokens de sincronização do Google Calendar');
        }
    }

    async executeForTenant(tenantId: string): Promise<void> {
        const configs = await this.repository.listAllGoogleOAuthTokens();
        const config = configs.find(c => c.tenantId === tenantId);
        if (!config) return;
        await this.syncTenantEvents(config);
    }

    private async syncTenantEvents(config: GoogleOAuthTokens): Promise<void> {
        const auth = await this.googleCalendar.getAuthenticatedClient(config.tenantId);
        if (!auth) return;

        const calendar = google.calendar({ version: 'v3', auth });
        const now = new Date();
        const timeMin = new Date();
        timeMin.setDate(now.getDate() - 7);
        const timeMax = new Date();
        timeMax.setDate(now.getDate() + 30);

        const response = await calendar.events.list({
            calendarId: config.calendarId ?? 'primary',
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            showDeleted: true
        });

        const events = response.data.items ?? [];
        if (events.length === 0) return;

        const patients = await this.repository.listPatients(config.tenantId);

        // ── 1. Processar exclusões primeiro ─────────────────────────────────
        for (const event of events) {
            if (!event.id) continue;
            if (event.status === 'cancelled') {
                try {
                    const existingAppt = await this.repository.findAppointmentByGoogleEventId(config.tenantId, event.id);
                    if (existingAppt) {
                        await this.repository.deleteAppointment(config.tenantId, existingAppt.id);
                        logger.info({ tenantId: config.tenantId, appointmentId: existingAppt.id, eventId: event.id }, '🗑️ Agendamento removido por exclusão no Google Calendar');
                    }
                } catch (eventErr) {
                    logger.error({ err: eventErr, eventId: event.id, tenantId: config.tenantId }, 'Erro ao remover agendamento cancelado no Google Calendar');
                }
            }
        }

        // ── 2. Separar eventos ativos em standalone e séries recorrentes ────
        const activeEvents = events.filter(
            e => e.id && e.status !== 'cancelled' && e.start?.dateTime && e.end?.dateTime
        );

        const seriesMap = new Map<string, typeof activeEvents>();
        const standaloneEvents: typeof activeEvents = [];

        for (const event of activeEvents) {
            if (event.recurringEventId) {
                const group = seriesMap.get(event.recurringEventId) ?? [];
                group.push(event);
                seriesMap.set(event.recurringEventId, group);
            } else {
                standaloneEvents.push(event);
            }
        }

        // ── 3. Processar eventos avulsos (comportamento atual, inalterado) ──
        for (const event of standaloneEvents) {
            try {
                await this.syncSingleEvent(config, event, patients);
            } catch (eventErr) {
                logger.error({ err: eventErr, eventId: event.id, tenantId: config.tenantId }, 'Erro ao sincronizar evento individual');
            }
        }

        // ── 4. Processar séries recorrentes do Google Calendar ──────────────
        for (const [recurringEventId, occurrences] of seriesMap) {
            try {
                await this.syncSeriesGroup(config, recurringEventId, occurrences, patients);
            } catch (seriesErr) {
                logger.error({ err: seriesErr, recurringEventId, tenantId: config.tenantId }, 'Erro ao sincronizar série recorrente do Google Calendar');
            }
        }
    }

    // Lógica original para eventos avulsos (sem recurringEventId)
    private async syncSingleEvent(
        config: GoogleOAuthTokens,
        event: any,
        patients: PsychotherapyPatient[]
    ): Promise<void> {
        const patient = this.isPastoralEvent(event.summary ?? '')
            ? await this.findOrCreatePastoralPatient(config, patients)
            : await this.findOrCreatePatient(config, event, patients);
        const start = new Date(event.start.dateTime);
        const end = new Date(event.end.dateTime);
        const durationMinutes = Math.max(10, Math.round((end.getTime() - start.getTime()) / 60_000));
        const targetStatus = this.resolveStatus(event.status ?? 'tentative');

        const existingAppt = await this.repository.findAppointmentByGoogleEventId(config.tenantId, event.id);

        if (!existingAppt) {
            // Busca ampla por horário: cobre race conditions E o caso onde o app salvou
            // o ID base da série GCal enquanto o sync retorna IDs de ocorrência (_timestamp).
            const windowStart = new Date(start.getTime() - 120_000);
            const windowEnd   = new Date(start.getTime() + 120_000);
            const nearby = await this.repository.listAppointments(config.tenantId, {
                patientId: patient.id,
                start: windowStart,
                end: windowEnd
            });

            // Prioridade 1: sem googleEventId (criado pelo app, ainda não vinculado)
            const unlinked = nearby.data.find(a => !a.googleEventId);
            if (unlinked) {
                await this.repository.updateAppointmentGoogleEvent(unlinked.id, config.tenantId, event.id, event.htmlLink ?? '');
                await this.updateExistingAppointment(config, unlinked, patient, { start, durationMinutes, targetStatus, event });
                logger.info({ tenantId: config.tenantId, appointmentId: unlinked.id, eventId: event.id }, '🔗 Agendamento avulso vinculado ao evento do Google Calendar');
                return;
            }

            // Prioridade 2: mesmo paciente, mesmo horário, googleEventId diferente
            // (ex: app armazenou ID base da série; sync retornou ID de ocorrência)
            if (nearby.data.length > 0) {
                const sameSlot = nearby.data[0];
                logger.info({ tenantId: config.tenantId, appointmentId: sameSlot.id, existingGcalId: sameSlot.googleEventId, newGcalId: event.id }, '🔗 Agendamento existente no mesmo horário — vinculando novo eventId (evita duplicata)');
                await this.repository.updateAppointmentGoogleEvent(sameSlot.id, config.tenantId, event.id, event.htmlLink ?? '');
                await this.updateExistingAppointment(config, sameSlot, patient, { start, durationMinutes, targetStatus, event });
                return;
            }

            const appt = await this.repository.saveAppointment({
                tenantId: config.tenantId,
                patientId: patient.id,
                scheduledAt: start,
                durationMinutes,
                status: targetStatus,
                notes: this.resolveNotes(patient, event)
            });
            await this.repository.updateAppointmentGoogleEvent(appt.id, config.tenantId, event.id, event.htmlLink ?? '');
            logger.info({ tenantId: config.tenantId, appointmentId: appt.id, eventId: event.id }, '✅ Novo agendamento importado do Google Calendar');
        } else {
            await this.updateExistingAppointment(config, existingAppt, patient, { start, durationMinutes, targetStatus, event });
        }
    }

    // Processa um grupo de ocorrências com o mesmo recurringEventId
    private async syncSeriesGroup(
        config: GoogleOAuthTokens,
        recurringEventId: string,
        events: any[],
        patients: PsychotherapyPatient[]
    ): Promise<void> {
        // Ordenar por data de início para garantir que a primeira ocorrência seja o root
        events.sort((a, b) => new Date(a.start.dateTime).getTime() - new Date(b.start.dateTime).getTime());

        // Verificar quais já existem no banco
        const existingMap = new Map<string, any>();
        for (const event of events) {
            const existing = await this.repository.findAppointmentByGoogleEventId(config.tenantId, event.id);
            if (existing) existingMap.set(event.id, existing);
        }

        // Descobrir o rootId a partir dos registros já existentes
        let rootId: string | null = null;
        for (const existing of existingMap.values()) {
            rootId = existing.parentId ?? existing.id;
            break;
        }

        // Fallback: o app pode ter criado um root com google_event_id = recurringEventId
        // (ID da série GCal base), enquanto singleEvents=true retorna IDs de ocorrências
        // no formato {baseId}_{timestamp}. Se existingMap ficou vazio, buscar pelo baseId.
        if (rootId === null) {
            const appRoot = await this.repository.findAppointmentByGoogleEventId(config.tenantId, recurringEventId);
            if (appRoot) {
                rootId = appRoot.parentId ?? appRoot.id;
                // Mapear a ocorrência na janela atual que coincide com o horário do root
                for (const ev of events) {
                    if (!existingMap.has(ev.id)) {
                        const t = new Date(ev.start.dateTime).getTime();
                        if (Math.abs(appRoot.scheduledAt.getTime() - t) < 60_000) {
                            existingMap.set(ev.id, appRoot);
                            break;
                        }
                    }
                }
            }
        }

        // Inferir tipo de recorrência pelo intervalo entre as duas primeiras ocorrências
        const inferredRecurrence = this.inferRecurrenceType(events);

        // Data fim aproximada = última ocorrência na janela atual
        const lastOccurrenceDate = events.length > 0
            ? new Date(events[events.length - 1].start.dateTime)
            : null;

        // Carregar membros da série do banco para detectar filhos criados pelo app sem googleEventId
        // (gerados via SavePsychotherapyAppointmentUseCase que não sincroniza filhos individualmente)
        let seriesMembers: any[] = [];
        if (rootId !== null) {
            seriesMembers = await this.repository.listSeriesAppointments(config.tenantId, rootId);
        }

        for (const event of events) {
            try {
                const existing = existingMap.get(event.id) ?? null;
                const start = new Date(event.start.dateTime);
                const end = new Date(event.end.dateTime);
                const durationMinutes = Math.max(10, Math.round((end.getTime() - start.getTime()) / 60_000));
                const targetStatus = this.resolveStatus(event.status ?? 'tentative');

                if (!existing) {
                    const patient = this.isPastoralEvent(event.summary ?? '')
                        ? await this.findOrCreatePastoralPatient(config, patients)
                        : await this.findOrCreatePatient(config, event, patients);

                    // Verificar se já existe um filho da série nessa data sem googleEventId
                    // (criado pelo app antes do pull-sync vincular)
                    const unlinkedSibling = seriesMembers.find(m =>
                        !m.googleEventId &&
                        Math.abs(m.scheduledAt.getTime() - start.getTime()) < 120_000
                    );

                    if (unlinkedSibling) {
                        await this.repository.updateAppointmentGoogleEvent(unlinkedSibling.id, config.tenantId, event.id, event.htmlLink ?? '');
                        await this.updateExistingAppointment(config, unlinkedSibling, patient, { start, durationMinutes, targetStatus, event });
                        logger.info({ tenantId: config.tenantId, appointmentId: unlinkedSibling.id, eventId: event.id }, '🔗 Filho de série vinculado ao evento do Google Calendar');
                        continue;
                    }

                    // Busca ampla: qualquer agendamento do paciente no mesmo horário,
                    // mesmo fora da série (orphan criado pelo app ou ID base vs. ocorrência)
                    const wStart = new Date(start.getTime() - 120_000);
                    const wEnd   = new Date(start.getTime() + 120_000);
                    const nearby = await this.repository.listAppointments(config.tenantId, {
                        patientId: patient.id,
                        start: wStart,
                        end: wEnd
                    });
                    const anyExisting = nearby.data.find(a =>
                        !existingMap.has(event.id) &&
                        (!a.googleEventId || Math.abs(a.scheduledAt.getTime() - start.getTime()) < 120_000)
                    );
                    if (anyExisting) {
                        await this.repository.updateAppointmentGoogleEvent(anyExisting.id, config.tenantId, event.id, event.htmlLink ?? '');
                        await this.updateExistingAppointment(config, anyExisting, patient, { start, durationMinutes, targetStatus, event });
                        existingMap.set(event.id, anyExisting);
                        logger.info({ tenantId: config.tenantId, appointmentId: anyExisting.id, eventId: event.id }, '🔗 Agendamento orphan no mesmo horário vinculado (evita duplicata em série)');
                        continue;
                    }

                    const isRoot = rootId === null;

                    const appt = await this.repository.saveAppointment({
                        tenantId: config.tenantId,
                        patientId: patient.id,
                        scheduledAt: start,
                        durationMinutes,
                        status: targetStatus,
                        notes: this.resolveNotes(patient, event),
                        recurrence: isRoot && inferredRecurrence ? inferredRecurrence : 'none',
                        recurrenceEndDate: isRoot && inferredRecurrence ? lastOccurrenceDate : null,
                        parentId: isRoot ? null : rootId
                    });

                    await this.repository.updateAppointmentGoogleEvent(appt.id, config.tenantId, event.id, event.htmlLink ?? '');

                    if (isRoot) {
                        rootId = appt.id;
                        seriesMembers = await this.repository.listSeriesAppointments(config.tenantId, rootId);
                    }

                    logger.info({
                        tenantId: config.tenantId,
                        appointmentId: appt.id,
                        eventId: event.id,
                        isRoot,
                        recurrence: isRoot ? inferredRecurrence : 'child'
                    }, '✅ Ocorrência recorrente importada do Google Calendar');
                } else {
                    const patient = patients.find(p => p.id === existing.patientId) ??
                        (this.isPastoralEvent(event.summary ?? '')
                            ? await this.findOrCreatePastoralPatient(config, patients)
                            : await this.findOrCreatePatient(config, event, patients));

                    // Garantir que parentId está correto para ocorrências já existentes sem vínculo
                    if (!existing.parentId && rootId && existing.id !== rootId) {
                        await this.repository.saveAppointment({
                            id: existing.id,
                            tenantId: config.tenantId,
                            patientId: existing.patientId,
                            scheduledAt: existing.scheduledAt,
                            durationMinutes: existing.durationMinutes,
                            status: existing.status,
                            notes: existing.notes,
                            recurrence: existing.recurrence,
                            recurrenceEndDate: existing.recurrenceEndDate,
                            parentId: rootId
                        });
                    }

                    await this.updateExistingAppointment(config, existing, patient, { start, durationMinutes, targetStatus, event });
                }
            } catch (eventErr) {
                logger.error({ err: eventErr, eventId: event.id, tenantId: config.tenantId }, 'Erro ao sincronizar ocorrência de série do Google Calendar');
            }
        }
    }

    // Atualiza dados de um agendamento existente se algo mudou
    private async updateExistingAppointment(
        config: GoogleOAuthTokens,
        existingAppt: any,
        patient: PsychotherapyPatient,
        { start, durationMinutes, targetStatus, event }: { start: Date; durationMinutes: number; targetStatus: AppointmentStatus; event: any }
    ): Promise<void> {
        const notesValue = this.resolveNotes(patient, event);
        const timeChanged = existingAppt.scheduledAt.getTime() !== start.getTime();
        const durationChanged = existingAppt.durationMinutes !== durationMinutes;
        const notesChanged = existingAppt.notes !== notesValue;

        if (timeChanged || durationChanged || notesChanged) {
            await this.repository.saveAppointment({
                id: existingAppt.id,
                tenantId: config.tenantId,
                patientId: existingAppt.patientId,
                scheduledAt: start,
                durationMinutes,
                status: existingAppt.status,
                notes: notesValue,
                recurrence: existingAppt.recurrence,
                recurrenceEndDate: existingAppt.recurrenceEndDate,
                parentId: existingAppt.parentId
            });
            logger.info({ tenantId: config.tenantId, appointmentId: existingAppt.id }, '🔄 Dados do agendamento atualizados a partir do Google Calendar');
        }

        if (existingAppt.status !== targetStatus) {
            const isTerminalLocalStatus = existingAppt.status !== 'scheduled' && existingAppt.status !== 'confirmed';
            
            // Só sobrescrevemos o status local se:
            // 1. O evento foi cancelado no Google Calendar
            // 2. O status local atual ainda é apenas de agendamento ('scheduled' ou 'confirmed')
            // Se o psicólogo já marcou presença/falta no app, o sync do GCal não deve reverter isso
            if (targetStatus === 'canceled' || !isTerminalLocalStatus) {
                await this.repository.updateAppointmentStatus(config.tenantId, existingAppt.id, targetStatus);
                logger.info({ tenantId: config.tenantId, appointmentId: existingAppt.id, oldStatus: existingAppt.status, newStatus: targetStatus }, '🔄 Status do agendamento atualizado a partir do Google Calendar');
            } else {
                logger.debug({ tenantId: config.tenantId, appointmentId: existingAppt.id, localStatus: existingAppt.status }, '⏭️ Status local mantido (não sobrescrito pelo GCal)');
            }
        }
    }

    // Encontra ou cadastra automaticamente o paciente a partir do evento
    private async findOrCreatePatient(
        config: GoogleOAuthTokens,
        event: any,
        patients: PsychotherapyPatient[]
    ): Promise<PsychotherapyPatient> {
        const parsed = this.parsePatientFromEvent(event);
        let patient = this.findExistingPatient(parsed, patients);

        if (!patient) {
            logger.info({ tenantId: config.tenantId, patientName: parsed.name }, '👤 Paciente não encontrado. Cadastrando automaticamente...');
            patient = await this.repository.savePatient({
                tenantId: config.tenantId,
                name: parsed.name,
                status: 'one_off',
                paymentType: 'per_session',
                defaultSessionPriceCents: null,
                phone: parsed.phone,
                email: parsed.email,
                reminderChannel: 'whatsapp'
            });
            patients.push(patient);
        }

        return patient;
    }

    // Infere 'weekly' ou 'biweekly' pelo intervalo entre as duas primeiras ocorrências
    private inferRecurrenceType(events: any[]): RecurrenceType | null {
        if (events.length < 2) return null;
        const t0 = new Date(events[0].start.dateTime).getTime();
        const t1 = new Date(events[1].start.dateTime).getTime();
        const diffDays = Math.round((t1 - t0) / (1000 * 60 * 60 * 24));
        if (diffDays === 7) return 'weekly';
        if (diffDays === 14) return 'biweekly';
        return null;
    }

    private parsePatientFromEvent(event: any): { name: string; phone: string | null; email: string | null } {
        const summary = event.summary ?? '';
        const description = event.description ?? '';

        const phone = this.extractPhoneNumber(summary + ' ' + description);

        let email: string | null = null;
        if (event.attendees?.length > 0) {
            const guest = event.attendees.find((a: any) => !a.self && a.email);
            if (guest) email = guest.email;
        }
        if (!email) {
            email = this.extractEmail(summary + ' ' + description);
        }

        let cleanName = summary.replace(/^Sessão\s*[-—]\s*/i, '');
        cleanName = cleanName.split('-')[0].trim() || summary.trim();

        return { name: cleanName, phone, email };
    }

    private findExistingPatient(
        parsed: { name: string; phone: string | null; email: string | null },
        patients: PsychotherapyPatient[]
    ): PsychotherapyPatient | null {
        if (parsed.phone) {
            const cleanParsed = parsed.phone.replace(/\D/g, '');
            const byPhone = patients.find(p => {
                if (!p.phone) return false;
                const cleanP = p.phone.replace(/\D/g, '');
                return cleanP === cleanParsed || cleanP.endsWith(cleanParsed) || cleanParsed.endsWith(cleanP);
            });
            if (byPhone) return byPhone;
        }

        if (parsed.email) {
            const byEmail = patients.find(p => p.email?.toLowerCase().trim() === parsed.email!.toLowerCase().trim());
            if (byEmail) return byEmail;
        }

        const normParsed = this.normalize(parsed.name);
        const byExactName = patients.find(p => this.normalize(p.name) === normParsed);
        if (byExactName) return byExactName;

        return patients.find(p => {
            const normP = this.normalize(p.name);
            return normParsed.includes(normP) || normP.includes(normParsed);
        }) ?? null;
    }

    private resolveStatus(gcalStatus: string): AppointmentStatus {
        if (gcalStatus === 'cancelled') return 'canceled';
        if (gcalStatus === 'confirmed') return 'confirmed';
        return 'scheduled';
    }

    private extractPhoneNumber(text: string): string | null {
        const regex = /(?:\+?55\s?)?\(?([1-9]\d)\)?\s?(?:9?\d{4}[-.\s]?\d{4})/g;
        const match = regex.exec(text);
        if (!match) return null;
        const clean = match[0].replace(/\D/g, '');
        if (clean.length === 10 || clean.length === 11) return '55' + clean;
        if (clean.length === 12 || clean.length === 13) return clean;
        return null;
    }

    private extractEmail(text: string): string | null {
        const match = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g.exec(text);
        return match ? match[0] : null;
    }

    private normalize(s: string): string {
        return s
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }
}
