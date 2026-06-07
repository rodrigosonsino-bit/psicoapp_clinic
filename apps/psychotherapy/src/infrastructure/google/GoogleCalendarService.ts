import { google, calendar_v3 } from 'googleapis';
import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';
import { PsychotherapyAppointment } from '../../domain/models/PsychotherapyAppointment';
import { logger } from '../logger';

// Usa o OAuth2Client embutido no googleapis para evitar conflito de versões com google-auth-library
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OAuth2Client = any;

const CALENDAR_NAME = process.env.GOOGLE_CALENDAR_NAME ?? 'Sessões_Terapia';
const TIMEZONE = process.env.TZ_CALENDAR ?? 'America/Sao_Paulo';

export interface GoogleAuthUrl {
    url: string;
}

@injectable()
export class GoogleCalendarService {
    private readonly clientId: string;
    private readonly clientSecret: string;
    private readonly redirectUri: string;

    constructor(
        @inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository
    ) {
        this.clientId = process.env.GOOGLE_CLIENT_ID ?? '';
        this.clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
        this.redirectUri = process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3333/auth/google/callback';
    }

    // ── OAuth2 ────────────────────────────────────────────────────────────────

    createOAuth2Client(): OAuth2Client {
        return new google.auth.OAuth2(this.clientId, this.clientSecret, this.redirectUri);
    }

    getAuthorizationUrl(tenantId: string): string {
        const oauth2Client = this.createOAuth2Client();
        return oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: ['https://www.googleapis.com/auth/calendar'],
            state: tenantId,
            prompt: 'consent',
        });
    }

    async exchangeCodeForTokens(code: string, tenantId: string): Promise<void> {
        const oauth2Client = this.createOAuth2Client();
        const { tokens } = await oauth2Client.getToken(code);

        if (!tokens.access_token || !tokens.refresh_token) {
            throw new Error('Google não retornou tokens válidos. Verifique as permissões OAuth.');
        }

        oauth2Client.setCredentials(tokens);

        // Encontrar ou criar o calendário dedicado
        const calendarId = await this.findOrCreateCalendar(oauth2Client);

        await this.repository.saveGoogleOAuthTokens(
            tenantId,
            tokens.access_token,
            tokens.refresh_token,
            tokens.expiry_date ?? Date.now() + 3600_000,
            calendarId
        );

        logger.info({ tenantId, calendarId }, '✅ Google Calendar conectado com sucesso');
    }

    async getAuthenticatedClient(tenantId: string): Promise<OAuth2Client | null> {
        const stored = await this.repository.getGoogleOAuthTokens(tenantId);
        if (!stored) return null;

        const oauth2Client = this.createOAuth2Client();
        oauth2Client.setCredentials({
            access_token: stored.accessToken,
            refresh_token: stored.refreshToken,
            expiry_date: stored.expiryDate ?? undefined,
        });

        // Auto-refresh se expirado
        oauth2Client.on('tokens', async (newTokens: { access_token?: string; expiry_date?: number }) => {
            if (newTokens.access_token) {
                await this.repository.updateGoogleAccessToken(
                    tenantId,
                    newTokens.access_token,
                    newTokens.expiry_date ?? Date.now() + 3600_000
                );
            }
        });

        return oauth2Client;
    }

    async isConnected(tenantId: string): Promise<boolean> {
        const tokens = await this.repository.getGoogleOAuthTokens(tenantId);
        return !!tokens?.refreshToken;
    }

    // ── Calendar management ───────────────────────────────────────────────────

    private async findOrCreateCalendar(auth: OAuth2Client): Promise<string> {
        const calendar = google.calendar({ version: 'v3', auth });

        // Lista todos os calendários do usuário
        const list = await calendar.calendarList.list();
        const existing = (list.data.items ?? []).find(
            (c) => c.summary === CALENDAR_NAME
        );

        if (existing?.id) {
            logger.info({ calendarId: existing.id }, `📅 Calendário "${CALENDAR_NAME}" encontrado`);
            return existing.id;
        }

        // Cria o calendário se não existir
        const created = await calendar.calendars.insert({
            requestBody: {
                summary: CALENDAR_NAME,
                description: 'Sessões de psicoterapia gerenciadas pelo PsicoApp',
                timeZone: TIMEZONE,
            },
        });

        logger.info({ calendarId: created.data.id }, `✨ Calendário "${CALENDAR_NAME}" criado`);
        return created.data.id!;
    }

    // ── Event sync ────────────────────────────────────────────────────────────

    async syncAppointment(
        tenantId: string,
        appointment: PsychotherapyAppointment,
        patientName: string,
        patientPhone: string | null,
        confirmUrl: string
    ): Promise<void> {
        const auth = await this.getAuthenticatedClient(tenantId);
        if (!auth) {
            logger.debug({ tenantId }, 'Google Calendar não conectado — sync ignorado');
            return;
        }

        const stored = await this.repository.getGoogleOAuthTokens(tenantId);
        const calendarId = stored?.calendarId ?? 'primary';
        const calendar = google.calendar({ version: 'v3', auth });

        const start = new Date(appointment.scheduledAt);
        const end = new Date(start.getTime() + appointment.durationMinutes * 60_000);

        // Filhos de série sem googleEventId ainda serão vinculados pelo pull-sync — não criar evento individual
        if (appointment.parentId && !appointment.googleEventId) {
            logger.debug({ appointmentId: appointment.id }, 'Filho de série sem googleEventId — aguardando vinculação pelo pull-sync');
            return;
        }

        const eventBody: calendar_v3.Schema$Event = {
            summary: `Sessão — ${patientName}`,
            description: [
                `Paciente: ${patientName}`,
                patientPhone ? `WhatsApp: ${patientPhone}` : null,
                appointment.notes ? `Obs: ${appointment.notes}` : null,
                '',
                `🔗 Link de confirmação do paciente:`,
                confirmUrl,
            ].filter(Boolean).join('\n'),
            start: { dateTime: start.toISOString(), timeZone: TIMEZONE },
            end: { dateTime: end.toISOString(), timeZone: TIMEZONE },
            status: this.mapStatus(appointment.status),
            reminders: {
                useDefault: false,
                overrides: [
                    { method: 'email', minutes: 24 * 60 },
                    { method: 'popup', minutes: 60 },
                ],
            },
        };

        // Root de série recorrente: adicionar RRULE para que o GCal exiba como evento recorrente
        if (appointment.recurrence !== 'none' && appointment.recurrenceEndDate && !appointment.parentId) {
            const until = new Date(appointment.recurrenceEndDate);
            until.setUTCHours(23, 59, 59, 0);
            const untilStr = until.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
            const interval = appointment.recurrence === 'biweekly' ? ';INTERVAL=2' : '';
            eventBody.recurrence = [`RRULE:FREQ=WEEKLY${interval};UNTIL=${untilStr}`];
        }

        try {
            if (appointment.googleEventId) {
                // Atualiza evento existente
                await calendar.events.update({
                    calendarId,
                    eventId: appointment.googleEventId,
                    requestBody: eventBody,
                });
                logger.info({ appointmentId: appointment.id, eventId: appointment.googleEventId }, '🔄 Evento Google Calendar atualizado');
            } else {
                // Cria novo evento
                const created = await calendar.events.insert({
                    calendarId,
                    requestBody: eventBody,
                });

                await this.repository.updateAppointmentGoogleEvent(
                    appointment.id,
                    tenantId,
                    created.data.id!,
                    created.data.htmlLink!
                );
                logger.info({ appointmentId: appointment.id, eventId: created.data.id }, '✅ Evento criado no Google Calendar');
            }
        } catch (err: any) {
            // Se evento não existe mais no Google, remove a referência local e tenta recriar
            if (err?.code === 404 && appointment.googleEventId) {
                logger.warn({ appointmentId: appointment.id }, 'Evento Google Calendar não encontrado — recriando');
                await this.repository.updateAppointmentGoogleEvent(appointment.id, tenantId, '', '');
            } else {
                logger.error({ err, appointmentId: appointment.id }, 'Erro ao sincronizar evento Google Calendar');
            }
        }
    }

    async deleteEvent(tenantId: string, googleEventId: string): Promise<void> {
        const auth = await this.getAuthenticatedClient(tenantId);
        if (!auth || !googleEventId) return;

        const stored = await this.repository.getGoogleOAuthTokens(tenantId);
        const calendarId = stored?.calendarId ?? 'primary';
        const calendar = google.calendar({ version: 'v3', auth });

        try {
            await calendar.events.delete({ calendarId, eventId: googleEventId });
            logger.info({ googleEventId }, '🗑️ Evento removido do Google Calendar');
        } catch (err) {
            logger.warn({ err, googleEventId }, 'Erro ao remover evento do Google Calendar');
        }
    }

    private mapStatus(status: PsychotherapyAppointment['status']): string {
        const map: Record<string, string> = {
            scheduled: 'tentative',
            confirmed: 'confirmed',
            attended: 'confirmed',
            canceled: 'cancelled',
            no_show: 'cancelled',
        };
        return map[status] ?? 'tentative';
    }
}
