import { Request, Response } from 'express';
import { injectable, inject } from 'tsyringe';
import { GoogleCalendarService } from '../../infrastructure/google/GoogleCalendarService';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { AppError } from '../../domain/errors/AppError';
import { logger } from '../../infrastructure/logger';

const APP_FRONTEND_URL = process.env.CORS_ORIGIN?.split(',')[0] ?? 'http://localhost:3000';

@injectable()
export class GoogleAuthController {
    constructor(
        @inject('GoogleCalendarService') private readonly googleCalendar: GoogleCalendarService,
        @inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository
    ) {}

    /** GET /auth/google/auth-url — retorna a URL do consent screen como JSON (chamado via fetch autenticado) */
    async getAuthUrl(req: Request, res: Response): Promise<Response> {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
            throw new AppError(
                'Google Calendar não está configurado. Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no servidor.',
                503
            );
        }

        const tenantId = (req as AuthenticatedRequest).tenantId || (req as AuthenticatedRequest).userId;
        if (!tenantId) throw new AppError('Tenant não identificado', 401);

        const url = await this.googleCalendar.getAuthorizationUrl(tenantId);
        return res.json({ url });
    }

    /** GET /auth/google/connect — redireciona para consent screen (mantido para compatibilidade) */
    async connect(req: Request, res: Response): Promise<void> {
        const tenantId = (req as AuthenticatedRequest).tenantId || (req as AuthenticatedRequest).userId;
        if (!tenantId) throw new AppError('Tenant não identificado', 401);

        const url = await this.googleCalendar.getAuthorizationUrl(tenantId);
        res.redirect(url);
    }

    /**
     * GET /auth/google/callback — recebe code+state, valida state, troca por
     * tokens. `state` NÃO é mais tratado como `tenantId` direto (CSRF de
     * OAuth corrigido) — GoogleCalendarService.exchangeCodeForTokens valida
     * o `state` contra `google_oauth_states` e só então resolve o tenant
     * real, o mesmo padrão já usado em GmailAuthController/GmailAuthService.
     */
    async callback(req: Request, res: Response): Promise<void> {
        const { code, state, error } = req.query as Record<string, string>;

        if (error) {
            logger.warn({ error }, 'Google OAuth negado pelo usuário');
            res.redirect(`${APP_FRONTEND_URL}/profile?google=denied`);
            return;
        }

        if (!code || !state) {
            res.redirect(`${APP_FRONTEND_URL}/profile?google=error`);
            return;
        }

        try {
            await this.googleCalendar.exchangeCodeForTokens(code, state);
            res.redirect(`${APP_FRONTEND_URL}/profile?google=connected`);
        } catch (err) {
            logger.error({ err }, 'Erro ao trocar code Google por tokens');
            res.redirect(`${APP_FRONTEND_URL}/profile?google=error`);
        }
    }

    /** GET /auth/google/status — verifica se o tenant tem Google Calendar conectado */
    async status(req: Request, res: Response): Promise<Response> {
        const tenantId = (req as AuthenticatedRequest).tenantId || (req as AuthenticatedRequest).userId;
        if (!tenantId) throw new AppError('Tenant não identificado', 401);

        const connected = await this.googleCalendar.isConnected(tenantId);
        const tokens = connected ? await this.repository.getGoogleOAuthTokens(tenantId) : null;

        return res.json({
            connected,
            calendarName: connected ? (process.env.GOOGLE_CALENDAR_NAME ?? 'Sessões_Terapia') : null,
            calendarId: tokens?.calendarId ?? null
        });
    }

    /** DELETE /auth/google/disconnect — revoga e remove tokens */
    async disconnect(req: Request, res: Response): Promise<Response> {
        const tenantId = (req as AuthenticatedRequest).tenantId || (req as AuthenticatedRequest).userId;
        if (!tenantId) throw new AppError('Tenant não identificado', 401);

        await this.repository.saveGoogleOAuthTokens(tenantId, '', '', 0, undefined);
        return res.status(200).json({ message: 'Google Calendar desconectado.' });
    }
}
