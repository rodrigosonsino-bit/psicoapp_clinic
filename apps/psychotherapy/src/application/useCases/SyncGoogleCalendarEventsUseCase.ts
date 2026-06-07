import { injectable, inject } from 'tsyringe';
import { google } from 'googleapis';
import { IPsychotherapyRepository, GoogleOAuthTokens } from '../../domain/repositories/IPsychotherapyRepository';
import { GoogleCalendarService } from '../../infrastructure/google/GoogleCalendarService';
import { PsychotherapyPatient } from '../../domain/models/PsychotherapyPatient';
import { AppointmentStatus } from '../../domain/models/PsychotherapyAppointment';
import { logger } from '../../infrastructure/logger';

@injectable()
export class SyncGoogleCalendarEventsUseCase {
    constructor(
        @inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository,
        @inject('GoogleCalendarService') private readonly googleCalendar: GoogleCalendarService
    ) {}

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
                continue;
            }

            if (!event.start?.dateTime || !event.end?.dateTime) continue;

            try {
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

                const start = new Date(event.start.dateTime);
                const end = new Date(event.end.dateTime);
                const durationMinutes = Math.max(10, Math.round((end.getTime() - start.getTime()) / 60_000));
                const targetStatus = this.resolveStatus(event.status ?? 'tentative');

                const existingAppt = await this.repository.findAppointmentByGoogleEventId(config.tenantId, event.id);

                if (!existingAppt) {
                    const appt = await this.repository.saveAppointment({
                        tenantId: config.tenantId,
                        patientId: patient.id,
                        scheduledAt: start,
                        durationMinutes,
                        status: targetStatus,
                        notes: event.description ?? null
                    });

                    await this.repository.updateAppointmentGoogleEvent(
                        appt.id,
                        config.tenantId,
                        event.id,
                        event.htmlLink ?? ''
                    );

                    logger.info({ tenantId: config.tenantId, appointmentId: appt.id, eventId: event.id }, '✅ Novo agendamento importado do Google Calendar');
                } else {
                    const timeChanged = existingAppt.scheduledAt.getTime() !== start.getTime();
                    const durationChanged = existingAppt.durationMinutes !== durationMinutes;
                    const notesChanged = existingAppt.notes !== (event.description ?? null);

                    if (timeChanged || durationChanged || notesChanged) {
                        await this.repository.saveAppointment({
                            id: existingAppt.id,
                            tenantId: config.tenantId,
                            patientId: existingAppt.patientId,
                            scheduledAt: start,
                            durationMinutes,
                            status: existingAppt.status,
                            notes: event.description ?? null
                        });
                        logger.info({ tenantId: config.tenantId, appointmentId: existingAppt.id }, '🔄 Dados do agendamento atualizados a partir do Google Calendar');
                    }

                    if (existingAppt.status !== targetStatus) {
                        await this.repository.updateAppointmentStatus(config.tenantId, existingAppt.id, targetStatus);
                        logger.info({ tenantId: config.tenantId, appointmentId: existingAppt.id, newStatus: targetStatus }, '🔄 Status do agendamento atualizado a partir do Google Calendar');
                    }
                }
            } catch (eventErr) {
                logger.error({ err: eventErr, eventId: event.id, tenantId: config.tenantId }, 'Erro ao sincronizar evento individual');
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
