import { Request, Response } from 'express';
import { injectable, inject } from 'tsyringe';
import { GmailAuthService } from '../../infrastructure/google/GmailAuthService';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { AppError } from '../../domain/errors/AppError';
import { logger } from '../../infrastructure/logger';

const APP_FRONTEND_URL = process.env.CORS_ORIGIN?.split(',')[0] ?? 'http://localhost:3000';

/**
 * Controller da conexão OAuth dedicada do Gmail (extrato bancário via
 * e-mail — fase 2 da conciliação bancária). Separado de
 * GoogleAuthController (Calendar) — não reaproveita nada dele, inclusive
 * pra não repetir o padrão inseguro de `state` que existe lá hoje.
 */
@injectable()
export class GmailAuthController {
    constructor(
        @inject(GmailAuthService) private readonly gmailAuth: GmailAuthService
    ) {}

    /** GET /auth/gmail/auth-url — retorna a URL do consent screen como JSON */
    async getAuthUrl(req: Request, res: Response): Promise<Response> {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
            throw new AppError(
                'Integração Google não está configurada. Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no servidor.',
                503
            );
        }

        const tenantId = (req as AuthenticatedRequest).tenantId || (req as AuthenticatedRequest).userId;
        if (!tenantId) throw new AppError('Tenant não identificado', 401);

        const url = await this.gmailAuth.getAuthorizationUrl(tenantId);
        return res.json({ url });
    }

    /** GET /auth/gmail/callback — recebe code+state, valida state, troca por tokens */
    async callback(req: Request, res: Response): Promise<void> {
        const { code, state, error } = req.query as Record<string, string>;

        if (error) {
            logger.warn({ error }, 'Gmail OAuth negado pelo usuário');
            res.redirect(`${APP_FRONTEND_URL}/profile?gmail=denied`);
            return;
        }

        if (!code || !state) {
            res.redirect(`${APP_FRONTEND_URL}/profile?gmail=error`);
            return;
        }

        try {
            await this.gmailAuth.handleCallback(code, state);
            res.redirect(`${APP_FRONTEND_URL}/profile?gmail=connected`);
        } catch (err) {
            logger.error({ err }, 'Erro ao trocar code do Gmail por tokens');
            res.redirect(`${APP_FRONTEND_URL}/profile?gmail=error`);
        }
    }

    /** GET /auth/gmail/status — verifica se o tenant tem Gmail conectado */
    async status(req: Request, res: Response): Promise<Response> {
        const tenantId = (req as AuthenticatedRequest).tenantId || (req as AuthenticatedRequest).userId;
        if (!tenantId) throw new AppError('Tenant não identificado', 401);

        const status = await this.gmailAuth.getStatus(tenantId);
        return res.json(status);
    }

    /** DELETE /auth/gmail/disconnect — revoga e remove tokens */
    async disconnect(req: Request, res: Response): Promise<Response> {
        const tenantId = (req as AuthenticatedRequest).tenantId || (req as AuthenticatedRequest).userId;
        if (!tenantId) throw new AppError('Tenant não identificado', 401);

        await this.gmailAuth.disconnect(tenantId);
        return res.status(200).json({ message: 'Gmail desconectado.' });
    }
}
