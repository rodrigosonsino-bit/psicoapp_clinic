import crypto from 'crypto';
import { google, calendar_v3 } from 'googleapis';
import { injectable, inject } from 'tsyringe';
import { Pool } from 'pg';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';
import { PsychotherapyAppointment } from '../../domain/models/PsychotherapyAppointment';
import { logger } from '../logger';
import { PASTORAL_SUMMARY_PREFIX } from '../../domain/constants/pastoral';

// Usa o OAuth2Client embutido no googleapis para evitar conflito de versões com google-auth-library
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OAuth2Client = any;

const CALENDAR_NAME = process.env.GOOGLE_CALENDAR_NAME ?? 'Sessões_Terapia';
const TIMEZONE = process.env.TZ_CALENDAR ?? 'America/Sao_Paulo';
const STATE_TTL_MINUTES = 10;

export interface GoogleAuthUrl {
    url: string;
}

@injectable()
export class GoogleCalendarService {
    private readonly clientId: string;
    private readonly clientSecret: string;
    private readonly redirectUri: string;

    constructor(
        @inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository,
        @inject(Pool) private readonly dbPool: Pool
    ) {
        this.clientId = process.env.GOOGLE_CLIENT_ID ?? '';
        this.clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
        this.redirectUri = process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3333/auth/google/callback';
    }

    // ── OAuth2 ────────────────────────────────────────────────────────────────

    createOAuth2Client(): OAuth2Client {
        return new google.auth.OAuth2(this.clientId, this.clientSecret, this.redirectUri);
    }

    /**
     * Gera a URL de consentimento com um `state` aleatório real (32 bytes),
     * gravando `sha256(token)` + `tenant_id` + `expires_at` em
     * `google_oauth_states` (tabela já existente desde a migration 041, mas
     * até aqui desconectada do fluxo real — o `state` era o `tenantId` cru,
     * aceito sem validação no callback, permitindo CSRF de OAuth: um
     * atacante podia forjar seu próprio `code` e vinculá-lo ao tenant de
     * outra pessoa. Mesmo padrão já usado em GmailAuthService.
     */
    async getAuthorizationUrl(tenantId: string): Promise<string> {
        const token = crypto.randomBytes(32).toString('hex');
        const stateHash = crypto.createHash('sha256').update(token).digest('hex');

        await this.dbPool.query(
            `INSERT INTO google_oauth_states (state_hash, tenant_id, expires_at)
             VALUES ($1, $2, NOW() + INTERVAL '${STATE_TTL_MINUTES} minutes')`,
            [stateHash, tenantId]
        );

        const oauth2Client = this.createOAuth2Client();
        return oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: ['https://www.googleapis.com/auth/calendar'],
            state: token,
            prompt: 'consent',
        });
    }

    /**
     * Valida o `state` recebido no callback: busca por `sha256(state)`,
     * exige `expires_at > NOW() AND consumed_at IS NULL`, marca
     * `consumed_at = NOW()` na mesma operação atômica (`UPDATE ... RETURNING`
     * — nunca ler depois escrever em passos separados, contra replay).
     * Lança erro explícito se inválido/expirado/já consumido.
     */
    private async consumeState(state: string): Promise<string> {
        const stateHash = crypto.createHash('sha256').update(state).digest('hex');

        const result = await this.dbPool.query<{ tenant_id: string }>(
            `UPDATE google_oauth_states
             SET consumed_at = NOW()
             WHERE state_hash = $1 AND expires_at > NOW() AND consumed_at IS NULL
             RETURNING tenant_id`,
            [stateHash]
        );

        const tenantId = result.rows[0]?.tenant_id;
        if (!tenantId) {
            throw new Error('State OAuth do Google Calendar inválido, expirado ou já utilizado.');
        }
        return tenantId;
    }

    /** `state` é validado/consumido aqui — o `tenantId` usado no restante do fluxo vem só disso, nunca de um valor cru recebido do cliente. */
    async exchangeCodeForTokens(code: string, state: string): Promise<void> {
        const tenantId = await this.consumeState(state);
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
        confirmUrl: string,
        isPastoral = false,
        forceCreate = false
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

        // Filhos de série sem googleEventId ainda serão vinculados pelo pull-sync — não criar evento individual.
        // forceCreate ignora essa espera (usado quando se sabe que não há RRULE cobrindo essa data, ex.:
        // um filho órfão entre duas séries, que precisa de um evento individual de qualquer forma).
        if (appointment.parentId && !appointment.googleEventId && !forceCreate) {
            logger.debug({ appointmentId: appointment.id }, 'Filho de série sem googleEventId — aguardando vinculação pelo pull-sync');
            return;
        }

        let summary = patientName;
        let description = [
            `Paciente: ${patientName}`,
            patientPhone ? `WhatsApp: ${patientPhone}` : null,
            appointment.notes ? `Obs: ${appointment.notes}` : null,
            '',
            `🔗 Link de confirmação do paciente:`,
            confirmUrl,
        ].filter(Boolean).join('\n');

        if (isPastoral) {
            const notes = appointment.notes ?? '';
            if (notes.startsWith(PASTORAL_SUMMARY_PREFIX)) {
                summary = notes.slice(PASTORAL_SUMMARY_PREFIX.length).split('\n')[0].trim();
                const lines = notes.slice(PASTORAL_SUMMARY_PREFIX.length).split('\n');
                description = lines.slice(1).join('\n').trim();
            } else {
                summary = notes.split('\n')[0].trim() || 'Compromisso Pastoral';
                description = notes.split('\n').slice(1).join('\n').trim();
            }
        }

        const eventBody: calendar_v3.Schema$Event = {
            summary,
            description,
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
            if (appointment.recurrence === 'monthly') {
                eventBody.recurrence = [`RRULE:FREQ=MONTHLY;UNTIL=${untilStr}`];
            } else {
                const interval = appointment.recurrence === 'biweekly' ? ';INTERVAL=2' : '';
                eventBody.recurrence = [`RRULE:FREQ=WEEKLY${interval};UNTIL=${untilStr}`];
            }
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
