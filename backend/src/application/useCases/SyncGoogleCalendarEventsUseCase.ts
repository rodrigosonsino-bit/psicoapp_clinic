import { injectable, inject } from 'tsyringe';
import { google } from 'googleapis';
import { IPsychotherapyRepository, GoogleOAuthTokens } from '../../domain/repositories/IPsychotherapyRepository';
import { GoogleCalendarService } from '../../infrastructure/google/GoogleCalendarService';
import { PsychotherapyPatient } from '../../domain/models/PsychotherapyPatient';
import { PsychotherapyAppointment } from '../../domain/models/PsychotherapyAppointment';
import { logger } from '../../infrastructure/logger';
import { PASTORAL_SENTINEL_EMAIL, PASTORAL_TITLE_REGEX } from '../../domain/constants/pastoral';
import { Pool } from 'pg';

const APP_BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:3000';

/**
 * Sincronização Google Calendar → PsicoApp.
 *
 * O PsicoApp é a referência (fonte da verdade) para os agendamentos. O Google
 * Calendar é um espelho de conveniência: o app empurra seus dados para lá
 * (GoogleCalendarService.syncAppointment), e esta classe faz o caminho
 * inverso (pull) apenas para:
 *   1. Vincular o googleEventId de eventos recém-criados pelo app a seus
 *      agendamentos correspondentes (necessário sobretudo para ocorrências
 *      de séries recorrentes, que não são empurradas individualmente).
 *   2. Detectar divergências (horário/duração alterados, ou evento
 *      cancelado/apagado direto no Google Calendar) e CORRIGIR o Google
 *      Calendar de volta para refletir o agendamento do app.
 *
 * Esta classe NUNCA cria novos agendamentos/pacientes a partir de eventos
 * que não têm correspondência no app, e nunca sobrescreve dados do app com
 * dados vindos do Google Calendar — qualquer correção feita por um terapeuta
 * deve ser feita no PsicoApp; o Google Calendar é corrigido automaticamente
 * no próximo ciclo de sincronização.
 */
@injectable()
export class SyncGoogleCalendarEventsUseCase {
    constructor(
        @inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository,
        @inject('GoogleCalendarService') private readonly googleCalendar: GoogleCalendarService,
        @inject(Pool) private readonly dbPool: Pool
    ) {}

    private isPastoralEvent(summary: string): boolean {
        return PASTORAL_TITLE_REGEX.test(summary.trim());
    }

    private confirmUrlFor(appt: PsychotherapyAppointment): string {
        return `${APP_BASE_URL}/confirm/${appt.confirmToken}`;
    }

    async execute(): Promise<void> {
        logger.info('🔄 Iniciando ciclo de sincronização de eventos do Google Calendar para o app...');
        try {
            const configs = await this.repository.listAllGoogleOAuthTokens();
            logger.info(`📅 Encontrados ${configs.length} tenants com Google Calendar conectado.`);

            for (const config of configs) {
                try {
                    await this.withTenantLock(config, () => this.syncTenantEvents(config));
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
        await this.withTenantLock(config, () => this.syncTenantEvents(config));
    }

    private async withTenantLock(config: GoogleOAuthTokens, work: () => Promise<void>): Promise<void> {
        const client = await this.dbPool.connect();
        const lockKey = `gcal-sync:${config.tenantId}`;
        let acquired = false;
        try {
            const result = await client.query<{ acquired: boolean }>(
                `SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired`,
                [lockKey]
            );
            acquired = result.rows[0]?.acquired === true;
            if (!acquired) {
                logger.info({ tenantId: config.tenantId }, 'Sync Google Calendar já está ativo para o tenant; execução ignorada');
                return;
            }
            await work();
        } finally {
            if (acquired) {
                try {
                    await client.query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [lockKey]);
                } catch (unlockErr) {
                    logger.error({ err: unlockErr, tenantId: config.tenantId }, 'Falha ao liberar lock do Google Calendar');
                }
            }
            client.release();
        }
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

        // ── 0. Agendamentos do app sem evento espelhado no Google: criar os que faltam ──
        // Cobre o caso de um push anterior ter falhado (ex.: 404 ao tentar atualizar um
        // evento já removido) e ter limpado a referência sem nunca recriar o evento.
        try {
            await this.createMissingGcalEvents(config.tenantId, timeMin, timeMax);
        } catch (err) {
            logger.error({ err, tenantId: config.tenantId }, 'Erro ao criar eventos faltantes no Google Calendar');
        }

        // Precisa carregar pacientes, pois as heurísticas (por nome/email) dependem da lista completa.
        const patients = await this.repository.listPatients(config.tenantId) as PsychotherapyPatient[];

        // ── 1. Eventos cancelados/apagados no Google: restaurar se o app ainda os tem ──
        for (const event of events) {
            if (!event.id) continue;
            if (event.status === 'cancelled') {
                try {
                    await this.restoreIfStillActiveInApp(config.tenantId, event.id);
                } catch (eventErr) {
                    logger.error({ err: eventErr, eventId: event.id, tenantId: config.tenantId }, 'Erro ao restaurar evento cancelado no Google Calendar');
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

        // ── 3. Eventos avulsos: vincular ID ou corrigir divergência. Nunca criar. ──
        for (const event of standaloneEvents) {
            try {
                await this.syncSingleEvent(config, event, patients);
            } catch (eventErr) {
                logger.error({ err: eventErr, eventId: event.id, tenantId: config.tenantId }, 'Erro ao sincronizar evento individual');
            }
        }

        // ── 4. Séries recorrentes: vincular IDs das ocorrências ou corrigir divergência ──
        for (const [recurringEventId, occurrences] of seriesMap) {
            try {
                await this.syncSeriesGroup(config, recurringEventId, occurrences, patients);
            } catch (seriesErr) {
                logger.error({ err: seriesErr, recurringEventId, tenantId: config.tenantId }, 'Erro ao sincronizar série recorrente do Google Calendar');
            }
        }
    }

    /**
     * Agendamentos do app que PERDERAM o evento espelhado no Google Calendar
     * — por exemplo, um push anterior que falhou ou um evento removido
     * externamente. O estado explícito evita usar string vazia como sentinel e
     * preserva registros históricos `null/idle`, que não devem ganhar evento
     * retroativamente.
     */
    private async createMissingGcalEvents(tenantId: string, timeMin: Date, timeMax: Date): Promise<void> {
        const { data: appointments } = await this.repository.listAppointments(tenantId, {
            start: timeMin,
            end: timeMax,
            limit: 200
        });

        const staleProcessingBefore = Date.now() - 10 * 60_000;
        const missing = appointments.filter(a =>
            (a.status === 'scheduled' || a.status === 'confirmed') && (
                a.googleSyncState === 'pending' ||
                a.googleSyncState === 'error' ||
                (a.googleSyncState === 'processing' &&
                    (a.googleSyncUpdatedAt?.getTime() ?? 0) < staleProcessingBefore)
            )
        );
        if (missing.length === 0) return;

        for (const appt of missing) {
            try {
                const patient = await this.repository.findPatientById(tenantId, appt.patientId);
                if (!patient) continue;

                // Se for filho de uma série, só forçamos a criação de um evento individual
                // quando temos certeza de que o RRULE do root NÃO cobre essa data (órfão real
                // entre duas séries). Se o root ainda cobre essa data, deixamos o pull-sync
                // normal vincular via correspondência de evento expandido — evita duplicar.
                const forceCreate = appt.parentId ? !(await this.isCoveredByRootRecurrence(tenantId, appt)) : false;

                const isPastoral = patient.email === PASTORAL_SENTINEL_EMAIL;
                await this.googleCalendar.syncAppointment(tenantId, appt, patient.name, patient.phone, this.confirmUrlFor(appt), isPastoral, forceCreate);
                logger.info({ tenantId, appointmentId: appt.id, forceCreate }, '🆕 Evento ausente recriado no Google Calendar a partir do PsicoApp (app é a referência)');
            } catch (err) {
                logger.error({ err, tenantId, appointmentId: appt.id }, 'Erro ao recriar evento ausente no Google Calendar');
            }
        }
    }

    /** Verifica se a data de um filho de série ainda cai dentro do RRULE ativo do root. */
    private async isCoveredByRootRecurrence(tenantId: string, child: PsychotherapyAppointment): Promise<boolean> {
        if (!child.parentId) return false;
        const root = await this.repository.findAppointmentById(tenantId, child.parentId);
        if (!root || root.recurrence === 'none' || !root.recurrenceEndDate) return false;
        if (child.scheduledAt.getTime() > root.recurrenceEndDate.getTime()) return false;

        const intervalDays = root.recurrence === 'weekly' ? 7 : 14;
        const diffDays = Math.round((child.scheduledAt.getTime() - root.scheduledAt.getTime()) / (1000 * 60 * 60 * 24));
        return diffDays >= 0 && diffDays % intervalDays === 0;
    }

    /**
     * Evento foi cancelado/apagado direto no Google Calendar. Se o app ainda
     * tem esse agendamento como ativo, restauramos o evento no Google
     * (o app é a referência — cancelar uma sessão deve ser feito no PsicoApp).
     */
    private async restoreIfStillActiveInApp(tenantId: string, googleEventId: string): Promise<void> {
        const existingAppt = await this.repository.findAppointmentByGoogleEventId(tenantId, googleEventId);
        if (!existingAppt) return; // Já não existe no app (ex.: apagado via PsicoApp) — nada a fazer.
        // Somente compromissos ainda pendentes são restauráveis. `attended` e
        // `no_show` são estados terminais: restaurar um root recorrente antigo
        // recriaria toda a série futura já encerrada no app.
        if (existingAppt.status !== 'scheduled' && existingAppt.status !== 'confirmed') return;

        const patient = await this.repository.findPatientById(tenantId, existingAppt.patientId);
        if (!patient) return;

        // Avança a geração via CAS. O ID da nova geração é determinístico, então
        // cron/manual concorrentes convergem para o mesmo evento.
        await this.repository.advanceAppointmentGoogleEventGeneration(
            existingAppt.id,
            tenantId,
            existingAppt.googleEventGeneration
        );
        const fresh = await this.repository.findAppointmentById(tenantId, existingAppt.id);
        if (!fresh) return;

        const isPastoral = patient.email === PASTORAL_SENTINEL_EMAIL;
        await this.googleCalendar.syncAppointment(tenantId, fresh, patient.name, patient.phone, this.confirmUrlFor(fresh), isPastoral);
        logger.info({ tenantId, appointmentId: fresh.id, googleEventId }, '♻️ Evento removido direto no Google Calendar — restaurado a partir do PsicoApp (app é a referência)');
    }

    /**
     * Se o horário/duração do evento no Google divergem do agendamento do app,
     * corrige o Google Calendar de volta (nunca o contrário).
     */
    private async correctDriftIfNeeded(
        tenantId: string,
        existingAppt: PsychotherapyAppointment,
        patient: PsychotherapyPatient,
        event: any
    ): Promise<void> {
        const start = new Date(event.start.dateTime);
        const end = new Date(event.end.dateTime);
        const durationMinutes = Math.max(10, Math.round((end.getTime() - start.getTime()) / 60_000));

        const timeDrifted = existingAppt.scheduledAt.getTime() !== start.getTime();
        const durationDrifted = existingAppt.durationMinutes !== durationMinutes;
        if (!timeDrifted && !durationDrifted) return;

        const target = await this.repairCorruptedSeriesLink(tenantId, existingAppt);
        const isPastoral = patient.email === PASTORAL_SENTINEL_EMAIL;
        await this.googleCalendar.syncAppointment(tenantId, target, patient.name, patient.phone, this.confirmUrlFor(target), isPastoral);
        logger.info(
            { tenantId, appointmentId: target.id, eventId: event.id },
            '🔧 Divergência no Google Calendar corrigida a partir do PsicoApp (app é a referência)'
        );
    }

    /**
     * Detecta um caso em que o agendamento RAIZ de uma série recorrente ficou
     * vinculado ao ID de uma OCORRÊNCIA específica (formato
     * "{idBase}_{timestamp}") em vez do ID do evento mestre. Tentar fazer
     * `events.update` nesse ID com RRULE é inválido para a API do Google
     * ("Invalid start time").
     *
     * BUG HISTÓRICO (corrigido aqui, 2026-07-20): a versão anterior limpava o
     * vínculo (`updateAppointmentGoogleEvent(..., '', '')`) e deixava o
     * próximo push recriar o evento mestre do zero. Isso abria um loop
     * infinito sempre que, em algum ciclo posterior, o agendamento fosse
     * relinkado a outra ocorrência (ex.: via `unlinkedSibling`/`anyExisting`
     * em `syncSeriesGroup`, que sempre vincula pelo `event.id` — formato de
     * ocorrência): a próxima passada detectava "corrompido" de novo, limpava
     * de novo, recriava de novo — cada recriação sendo uma SÉRIE SEMANAL
     * NOVA no Google Calendar. Um caso real gerou ~98 séries fantasmas
     * duplicadas do mesmo paciente no mesmo horário, todas com RRULE
     * semanal, poluindo a agenda real todas as semanas até a data de término
     * da recorrência.
     *
     * Fix: o ID mestre é sempre o prefixo do ID de ocorrência antes do
     * timestamp final (convenção estável da API do Google Calendar pra
     * `events.list({singleEvents:true})`) — reparamos IN PLACE pra esse ID
     * mestre em vez de limpar, nunca recriando um evento que já existe.
     */
    private async repairCorruptedSeriesLink(
        tenantId: string,
        appt: PsychotherapyAppointment
    ): Promise<PsychotherapyAppointment> {
        const occurrenceMatch = /^(.+)_[0-9]{8}T[0-9]{6}Z$/.exec(appt.googleEventId ?? '');
        if (appt.parentId || !occurrenceMatch) return appt;

        const masterEventId = occurrenceMatch[1];
        await this.repository.updateAppointmentGoogleEvent(appt.id, tenantId, masterEventId, appt.googleEventUrl ?? '');
        const fresh = await this.repository.findAppointmentById(tenantId, appt.id);
        logger.warn(
            { tenantId, appointmentId: appt.id, badEventId: appt.googleEventId, repairedTo: masterEventId },
            '🩹 Vínculo corrompido (raiz de série apontava para ID de ocorrência) — reparado para o ID do evento mestre, sem recriar'
        );
        return fresh ?? appt;
    }

    // Lógica para eventos avulsos (sem recurringEventId): vincular ID ou corrigir divergência.
    private async syncSingleEvent(
        config: GoogleOAuthTokens,
        event: any,
        patients: PsychotherapyPatient[]
    ): Promise<void> {
        const existingAppt = await this.repository.findAppointmentByGoogleEventId(config.tenantId, event.id);

        if (existingAppt) {
            const patient = await this.repository.findPatientById(config.tenantId, existingAppt.patientId);
            if (!patient) return;
            await this.correctDriftIfNeeded(config.tenantId, existingAppt, patient, event);
            return;
        }

        // Não vinculado ainda. Só tentamos linkar a um agendamento do app já
        // existente (criado pelo app, aguardando o googleEventId ser anexado).
        // Precisamos identificar o paciente para restringir a busca por horário.
        const patient = this.isPastoralEvent(event.summary ?? '')
            ? patients.find(p => p.email === PASTORAL_SENTINEL_EMAIL)
            : this.findExistingPatient(this.parsePatientFromEvent(event), patients);

        if (!patient) {
            logger.info({ tenantId: config.tenantId, eventId: event.id }, '⏭️ Evento do Google Calendar sem paciente correspondente no PsicoApp — ignorado (app é a referência)');
            return;
        }

        const start = new Date(event.start.dateTime);
        const windowStart = new Date(start.getTime() - 120_000);
        const windowEnd = new Date(start.getTime() + 120_000);
        const nearby = await this.repository.listAppointments(config.tenantId, {
            patientId: patient.id,
            start: windowStart,
            end: windowEnd
        });

        // Prioridade 1: sem googleEventId (criado pelo app, ainda não vinculado).
        const unlinked = nearby.data.find(a => !a.googleEventId);
        if (unlinked) {
            await this.repository.updateAppointmentGoogleEvent(unlinked.id, config.tenantId, event.id, event.htmlLink ?? '');
            logger.info({ tenantId: config.tenantId, appointmentId: unlinked.id, eventId: event.id }, '🔗 Agendamento avulso vinculado ao evento do Google Calendar');
            const refreshed = await this.repository.findAppointmentById(config.tenantId, unlinked.id);
            if (refreshed) await this.correctDriftIfNeeded(config.tenantId, refreshed, patient, event);
            return;
        }

        // Prioridade 2: mesmo paciente, mesmo horário, googleEventId diferente
        // (ex: app armazenou ID base da série; sync retornou ID de ocorrência).
        if (nearby.data.length > 0) {
            const sameSlot = nearby.data[0];
            logger.info({ tenantId: config.tenantId, appointmentId: sameSlot.id, existingGcalId: sameSlot.googleEventId, newGcalId: event.id }, '🔗 Agendamento existente no mesmo horário — vinculando novo eventId (evita duplicata)');
            await this.repository.updateAppointmentGoogleEvent(sameSlot.id, config.tenantId, event.id, event.htmlLink ?? '');
            const refreshed = await this.repository.findAppointmentById(config.tenantId, sameSlot.id);
            if (refreshed) await this.correctDriftIfNeeded(config.tenantId, refreshed, patient, event);
            return;
        }

        // Nenhuma correspondência no app: evento criado direto no Google Calendar.
        // O PsicoApp é a referência — não importamos automaticamente.
        logger.info({ tenantId: config.tenantId, eventId: event.id, patientId: patient.id }, '⏭️ Evento do Google Calendar sem agendamento correspondente no PsicoApp — ignorado (app é a referência)');
    }

    // Processa um grupo de ocorrências com o mesmo recurringEventId: vincula IDs e corrige divergências.
    private async syncSeriesGroup(
        config: GoogleOAuthTokens,
        recurringEventId: string,
        events: any[],
        patients: PsychotherapyPatient[]
    ): Promise<void> {
        events.sort((a, b) => new Date(a.start.dateTime).getTime() - new Date(b.start.dateTime).getTime());

        // Verificar quais já existem no banco
        const existingMap = new Map<string, PsychotherapyAppointment>();
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

        // Carregar membros da série do banco para vincular filhos criados pelo app sem googleEventId
        // (gerados via SavePsychotherapyAppointmentUseCase, que não sincroniza filhos individualmente).
        let seriesMembers: PsychotherapyAppointment[] = [];
        if (rootId !== null) {
            seriesMembers = await this.repository.listSeriesAppointments(config.tenantId, rootId);
        }

        for (const event of events) {
            try {
                const existing = existingMap.get(event.id) ?? null;
                const start = new Date(event.start.dateTime);

                if (existing) {
                    const patient = await this.repository.findPatientById(config.tenantId, existing.patientId);
                    if (!patient) continue;

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

                    await this.correctDriftIfNeeded(config.tenantId, existing, patient, event);
                    continue;
                }

                // Não vinculado ainda — tentar linkar a um filho de série criado pelo app sem googleEventId,
                // ou a qualquer agendamento órfão do paciente no mesmo horário.
                const patient = this.isPastoralEvent(event.summary ?? '')
                    ? patients.find(p => p.email === PASTORAL_SENTINEL_EMAIL)
                    : this.findExistingPatient(this.parsePatientFromEvent(event), patients);

                if (!patient) {
                    logger.info({ tenantId: config.tenantId, eventId: event.id }, '⏭️ Ocorrência de série sem paciente correspondente no PsicoApp — ignorada (app é a referência)');
                    continue;
                }

                const unlinkedSibling = seriesMembers.find(m =>
                    !m.googleEventId &&
                    Math.abs(m.scheduledAt.getTime() - start.getTime()) < 120_000
                );

                if (unlinkedSibling) {
                    await this.repository.updateAppointmentGoogleEvent(unlinkedSibling.id, config.tenantId, event.id, event.htmlLink ?? '');
                    logger.info({ tenantId: config.tenantId, appointmentId: unlinkedSibling.id, eventId: event.id }, '🔗 Filho de série vinculado ao evento do Google Calendar');
                    const refreshed = await this.repository.findAppointmentById(config.tenantId, unlinkedSibling.id);
                    if (refreshed) {
                        await this.correctDriftIfNeeded(config.tenantId, refreshed, patient, event);
                        existingMap.set(event.id, refreshed);
                    }
                    continue;
                }

                const wStart = new Date(start.getTime() - 120_000);
                const wEnd = new Date(start.getTime() + 120_000);
                const nearby = await this.repository.listAppointments(config.tenantId, {
                    patientId: patient.id,
                    start: wStart,
                    end: wEnd
                });
                const anyExisting = nearby.data.find(a => !a.googleEventId || Math.abs(a.scheduledAt.getTime() - start.getTime()) < 120_000);
                if (anyExisting) {
                    await this.repository.updateAppointmentGoogleEvent(anyExisting.id, config.tenantId, event.id, event.htmlLink ?? '');
                    logger.info({ tenantId: config.tenantId, appointmentId: anyExisting.id, eventId: event.id }, '🔗 Agendamento órfão no mesmo horário vinculado (evita duplicata em série)');
                    const refreshed = await this.repository.findAppointmentById(config.tenantId, anyExisting.id);
                    if (refreshed) {
                        await this.correctDriftIfNeeded(config.tenantId, refreshed, patient, event);
                        existingMap.set(event.id, refreshed);
                    }
                    continue;
                }

                // Nenhuma correspondência no app: ocorrência criada direto no Google Calendar.
                // O PsicoApp é a referência — não importamos automaticamente.
                logger.info({ tenantId: config.tenantId, eventId: event.id, patientId: patient.id }, '⏭️ Ocorrência de série sem agendamento correspondente no PsicoApp — ignorada (app é a referência)');
            } catch (eventErr) {
                logger.error({ err: eventErr, eventId: event.id, tenantId: config.tenantId }, 'Erro ao sincronizar ocorrência de série do Google Calendar');
            }
        }
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
