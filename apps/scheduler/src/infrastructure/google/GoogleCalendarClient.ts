import { google } from 'googleapis';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import { logger } from '../logger/logger';

export interface GoogleCalendarConfig {
    userId: string;
    accessToken: string;
    refreshToken: string;
    expiryDate: number;
    email?: string;
    isEnabled: boolean;
    calendarId?: string;
    calendarName?: string;
}

export interface GoogleCalendarItem {
    id: string;
    summary: string;
    description?: string;
    primary?: boolean;
    backgroundColor?: string;
}

export class GoogleCalendarClient {
    private oauth2Client: any;
    private dbPool: Pool;

    constructor(dbPool: Pool) {
        this.dbPool = dbPool;
        const clientId = process.env.GOOGLE_CLIENT_ID || 'MOCK_CLIENT_ID';
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET || 'MOCK_CLIENT_SECRET';
        
        const redirectUri = process.env.GOOGLE_REDIRECT_URI;
        if (!redirectUri && process.env.NODE_ENV === 'production') {
            throw new Error('FATAL: A variável de ambiente GOOGLE_REDIRECT_URI é obrigatória em produção.');
        }
        const finalRedirectUri = redirectUri || 'http://localhost:3000/api/google/callback';

        this.oauth2Client = new google.auth.OAuth2(
            clientId,
            clientSecret,
            finalRedirectUri
        );
    }

    private getOAuthStateSecret(): string {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
            if (process.env.NODE_ENV === 'production') {
                throw new Error('FATAL: JWT_SECRET é obrigatório para assinar o state do Google OAuth em produção.');
            }
            return 'fallback-secret-for-development-only-please-change';
        }
        return secret;
    }

    public getAuthUrl(userId: string): string {
        const stateToken = jwt.sign({ tenantId: userId }, this.getOAuthStateSecret(), { expiresIn: '15m' });

        // Se as credenciais do Google não estiverem configuradas no .env, podemos rodar um fluxo mock
        if (process.env.GOOGLE_CLIENT_ID === 'MOCK_CLIENT_ID' || !process.env.GOOGLE_CLIENT_ID) {
            return `http://localhost:3000/api/google/callback?mock=true&state=${encodeURIComponent(stateToken)}`;
        }

        return this.oauth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'select_account consent',
            scope: [
                'https://www.googleapis.com/auth/calendar.events',
                'https://www.googleapis.com/auth/userinfo.email'
            ],
            state: stateToken
        });
    }

    public async handleCallback(code: string, isMock: boolean = false, stateToken?: string): Promise<GoogleCalendarConfig> {
        let accessToken = 'mock_access_token';
        let refreshToken = 'mock_refresh_token';
        let expiryDate = Date.now() + 3600 * 1000;
        let email = 'rodrigo@example.com';
        let userId: string;

        if (!stateToken) {
            throw new Error('Parâmetro state ausente na resposta do Google OAuth.');
        }

        try {
            const decoded = jwt.verify(stateToken, this.getOAuthStateSecret()) as { tenantId?: string };
            if (!decoded.tenantId) {
                throw new Error('tenantId ausente no state.');
            }
            userId = decoded.tenantId;
        } catch (err) {
            logger.error({ err }, 'Falha na verificação de assinatura do JWT State do Google OAuth.');
            throw new Error('Google OAuth State inválido ou expirado.');
        }

        if (!isMock) {
            const { tokens } = await this.oauth2Client.getToken(code);
            accessToken = tokens.access_token || '';
            refreshToken = tokens.refresh_token || '';
            expiryDate = tokens.expiry_date || (Date.now() + 3600 * 1000);

            // Obter e-mail do usuário
            try {
                this.oauth2Client.setCredentials(tokens);
                const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
                const userInfo = await oauth2.userinfo.get();
                email = userInfo.data.email || 'desconhecido@gmail.com';
            } catch (err) {
                logger.error({ err }, 'Erro ao obter e-mail do usuário no Google');
            }
        }

        const config: GoogleCalendarConfig = {
            userId,
            accessToken,
            refreshToken,
            expiryDate,
            email,
            isEnabled: true
        };

        await this.saveConfig(config);
        return config;
    }

    public async getActiveConfigs(): Promise<GoogleCalendarConfig[]> {
        const result = await this.dbPool.query(
            'SELECT user_id as "userId", access_token as "accessToken", refresh_token as "refreshToken", expiry_date as "expiryDate", email, is_enabled as "isEnabled", calendar_id as "calendarId", calendar_name as "calendarName" FROM google_calendar_configs WHERE is_enabled = true;'
        );
        return result.rows;
    }

    public async getConfig(userId: string): Promise<GoogleCalendarConfig | null> {
        const result = await this.dbPool.query(
            'SELECT user_id as "userId", access_token as "accessToken", refresh_token as "refreshToken", expiry_date as "expiryDate", email, is_enabled as "isEnabled", calendar_id as "calendarId", calendar_name as "calendarName" FROM google_calendar_configs WHERE user_id = $1;',
            [userId]
        );
        if (result.rows.length === 0) return null;
        return result.rows[0];
    }

    public async deleteConfig(userId: string): Promise<void> {
        await this.dbPool.query('DELETE FROM google_calendar_configs WHERE user_id = $1;', [userId]);
    }

    private async saveConfig(config: GoogleCalendarConfig): Promise<void> {
        await this.dbPool.query(
            `INSERT INTO google_calendar_configs (user_id, access_token, refresh_token, expiry_date, email, is_enabled, calendar_id, calendar_name, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
             ON CONFLICT (user_id)
             DO UPDATE SET 
                access_token = EXCLUDED.access_token,
                refresh_token = EXCLUDED.refresh_token,
                expiry_date = EXCLUDED.expiry_date,
                email = EXCLUDED.email,
                is_enabled = EXCLUDED.is_enabled,
                calendar_id = EXCLUDED.calendar_id,
                calendar_name = EXCLUDED.calendar_name,
                updated_at = NOW();`,
            [config.userId, config.accessToken, config.refreshToken, config.expiryDate, config.email, config.isEnabled, config.calendarId || 'primary', config.calendarName || 'Principal']
        );
    }

    public async listCalendars(userId: string): Promise<GoogleCalendarItem[]> {
        const config = await this.getConfig(userId);
        if (!config) {
            throw new Error('Usuário não conectou o Google Calendar.');
        }

        if (config.accessToken === 'mock_access_token') {
            return [
                { id: 'primary', summary: 'Agenda Principal', primary: true, backgroundColor: '#4285f4' },
                { id: 'work@example.com', summary: 'Trabalho', primary: false, backgroundColor: '#0b8043' },
                { id: 'personal@example.com', summary: 'Pessoal', primary: false, backgroundColor: '#8e24aa' },
            ];
        }

        const client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
        );
        client.setCredentials({
            access_token: config.accessToken,
            refresh_token: config.refreshToken,
            expiry_date: config.expiryDate
        });

        client.on('tokens', async (tokens) => {
            if (tokens.access_token) {
                config.accessToken = tokens.access_token;
                if (tokens.expiry_date) config.expiryDate = tokens.expiry_date;
                await this.saveConfig(config);
            }
        });

        const calendar = google.calendar({ version: 'v3', auth: client });
        try {
            const response = await calendar.calendarList.list();
            return (response.data.items || []).map(cal => ({
                id: cal.id || '',
                summary: cal.summary || 'Sem nome',
                description: cal.description || undefined,
                primary: cal.primary || false,
                backgroundColor: cal.backgroundColor || undefined
            }));
        } catch (err) {
            logger.error({ err, userId }, 'Erro ao listar calendários do Google');
            throw new Error('Falha ao listar calendários. Reconecte sua conta Google.');
        }
    }

    public async selectCalendar(userId: string, calendarId: string, calendarName: string): Promise<void> {
        await this.dbPool.query(
            'UPDATE google_calendar_configs SET calendar_id = $1, calendar_name = $2, updated_at = NOW() WHERE user_id = $3;',
            [calendarId, calendarName, userId]
        );
        logger.info(`📅 Usuário ${userId} selecionou a agenda: "${calendarName}" (${calendarId})`);
    }

    public async getUpcomingEvents(config: GoogleCalendarConfig): Promise<any[]> {
        if (config.accessToken === 'mock_access_token') {
            // MOCK: Retornar alguns eventos de teste fictícios para testar sem precisar da API Real do Google!
            logger.info('Simulando eventos do Google Calendar via Mock...');
            const now = new Date();
            
            // Evento 1: Amanhã às 14h00
            const tomorrow = new Date(now);
            tomorrow.setDate(now.getDate() + 1);
            tomorrow.setHours(14, 0, 0, 0);

            // Evento 2: Amanhã às 16h30
            const tomorrow2 = new Date(now);
            tomorrow2.setDate(now.getDate() + 1);
            tomorrow2.setHours(16, 30, 0, 0);

            return [
                {
                    id: 'mock_event_1',
                    summary: 'Consulta Dr. Rodrigo - João Silva',
                    description: 'Paciente João Silva. Celular do paciente: 5518996994225. Lembrete automático ativo.',
                    start: { dateTime: tomorrow.toISOString() },
                    end: { dateTime: new Date(tomorrow.getTime() + 3600000).toISOString() },
                    attendees: [{ email: 'joao.silva@example.com' }]
                },
                {
                    id: 'mock_event_2',
                    summary: 'Reunião de Alinhamento - Maria Souza',
                    description: 'Contato: 5518996994225',
                    start: { dateTime: tomorrow2.toISOString() },
                    end: { dateTime: new Date(tomorrow2.getTime() + 1800000).toISOString() },
                    attendees: [{ email: 'maria.souza@example.com' }]
                }
            ];
        }

        // Fluxo Real do Google Calendar
        const client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
        );

        client.setCredentials({
            access_token: config.accessToken,
            refresh_token: config.refreshToken,
            expiry_date: config.expiryDate
        });

        // Ouvir refresh de token automático
        client.on('tokens', async (tokens) => {
            if (tokens.access_token) {
                config.accessToken = tokens.access_token;
                if (tokens.expiry_date) config.expiryDate = tokens.expiry_date;
                await this.saveConfig(config);
                logger.info('Token do Google Calendar atualizado automaticamente.');
            }
        });

        const calendar = google.calendar({ version: 'v3', auth: client });
        const now = new Date();
        const maxTime = new Date();
        maxTime.setDate(now.getDate() + 7); // Buscar próximos 7 dias

        try {
            const selectedCalId = config.calendarId || 'primary';
            logger.info(`📅 Buscando eventos do calendário: ${selectedCalId} (${config.calendarName || 'Principal'})`);
            const response = await calendar.events.list({
                calendarId: selectedCalId,
                timeMin: now.toISOString(),
                timeMax: maxTime.toISOString(),
                singleEvents: true,
                orderBy: 'startTime'
            });

            return response.data.items || [];
        } catch (err) {
            logger.error({ err, userId: config.userId }, 'Erro ao buscar eventos do Google Calendar');
            return [];
        }
    }

    public async getEventsWithPreferences(userId: string): Promise<any[]> {
        const config = await this.getConfig(userId);
        if (!config) return [];

        const events = await this.getUpcomingEvents(config);
        
        // Buscar preferências salvas
        const prefsResult = await this.dbPool.query(
            'SELECT event_id, auto_send FROM google_event_preferences WHERE user_id = $1;',
            [userId]
        );
        const prefsMap = new Map<string, boolean>();
        for (const row of prefsResult.rows) {
            prefsMap.set(row.event_id, row.auto_send);
        }

        return events.map(event => ({
            id: event.id,
            summary: event.summary || 'Sem título',
            description: event.description || '',
            start: event.start?.dateTime || event.start?.date || '',
            end: event.end?.dateTime || event.end?.date || '',
            attendees: (event.attendees || []).map((a: any) => a.email),
            autoSend: prefsMap.has(event.id) ? prefsMap.get(event.id) : true // default: enviar
        }));
    }

    public async setEventPreference(userId: string, eventId: string, autoSend: boolean, eventSummary?: string, eventStart?: string): Promise<void> {
        await this.dbPool.query(
            `INSERT INTO google_event_preferences (user_id, event_id, auto_send, event_summary, event_start, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (user_id, event_id)
             DO UPDATE SET auto_send = $3, updated_at = NOW();`,
            [userId, eventId, autoSend, eventSummary || null, eventStart || null]
        );
        logger.info(`📅 Preferência de evento atualizada: ${eventId} -> autoSend=${autoSend}`);
    }

    public async isEventAutoSendEnabled(userId: string, eventId: string): Promise<boolean> {
        const result = await this.dbPool.query(
            'SELECT auto_send FROM google_event_preferences WHERE user_id = $1 AND event_id = $2;',
            [userId, eventId]
        );
        if (result.rows.length === 0) return true; // default: enviar
        return result.rows[0].auto_send;
    }

    public async deleteEvent(userId: string, eventId: string): Promise<void> {
        const config = await this.getConfig(userId);
        if (!config) {
            throw new Error('Usuário não conectou o Google Calendar.');
        }

        if (config.accessToken === 'mock_access_token') {
            logger.info(`[MOCK] Cancelando evento ${eventId} do Google Calendar...`);
            return;
        }

        const client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
        );

        client.setCredentials({
            access_token: config.accessToken,
            refresh_token: config.refreshToken,
            expiry_date: config.expiryDate
        });

        // Ouvir refresh de token automático
        client.on('tokens', async (tokens) => {
            if (tokens.access_token) {
                config.accessToken = tokens.access_token;
                if (tokens.expiry_date) config.expiryDate = tokens.expiry_date;
                await this.saveConfig(config);
                logger.info('Token do Google Calendar atualizado automaticamente.');
            }
        });

        const calendar = google.calendar({ version: 'v3', auth: client });
        const selectedCalId = config.calendarId || 'primary';

        try {
            logger.info(`📅 Deletando evento ${eventId} do calendário ${selectedCalId}`);
            await calendar.events.delete({
                calendarId: selectedCalId,
                eventId: eventId
            });
            logger.info(`📅 Evento ${eventId} deletado com sucesso do Google Calendar.`);
        } catch (err) {
            logger.error({ err, userId, eventId }, 'Erro ao deletar evento do Google Calendar');
            throw new Error('Falha ao deletar evento no Google Calendar.');
        }
    }

    public async createEvent(
        userId: string,
        summary: string,
        description: string,
        startTimeIso: string,
        endTimeIso: string
    ): Promise<any> {
        const config = await this.getConfig(userId);
        if (!config) {
            throw new Error('Usuário não conectou o Google Calendar.');
        }

        if (config.accessToken === 'mock_access_token') {
            logger.info(`[MOCK] Criando evento "${summary}" de ${startTimeIso} até ${endTimeIso} no Google Calendar...`);
            return { id: `mock_event_${Date.now()}` };
        }

        const client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
        );

        client.setCredentials({
            access_token: config.accessToken,
            refresh_token: config.refreshToken,
            expiry_date: config.expiryDate
        });

        // Ouvir refresh de token automático
        client.on('tokens', async (tokens) => {
            if (tokens.access_token) {
                config.accessToken = tokens.access_token;
                if (tokens.expiry_date) config.expiryDate = tokens.expiry_date;
                await this.saveConfig(config);
                logger.info('Token do Google Calendar atualizado automaticamente.');
            }
        });

        const calendar = google.calendar({ version: 'v3', auth: client });
        const selectedCalId = config.calendarId || 'primary';

        try {
            logger.info(`📅 Criando evento "${summary}" no calendário ${selectedCalId}`);
            const response = await calendar.events.insert({
                calendarId: selectedCalId,
                requestBody: {
                    summary: summary,
                    description: description,
                    start: {
                        dateTime: startTimeIso,
                        timeZone: 'America/Sao_Paulo'
                    },
                    end: {
                        dateTime: endTimeIso,
                        timeZone: 'America/Sao_Paulo'
                    }
                }
            });
            logger.info(`📅 Evento criado com sucesso no Google Calendar (ID: ${response.data.id}).`);
            return response.data;
        } catch (err) {
            logger.error({ err, userId, summary }, 'Erro ao criar evento no Google Calendar');
            throw new Error('Falha ao criar evento no Google Calendar.');
        }
    }
}
