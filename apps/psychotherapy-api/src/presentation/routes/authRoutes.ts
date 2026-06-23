import { Router } from 'express';
import { z } from 'zod';
import { container } from '../../container';
import { AuthController } from '../controllers/AuthController';
import { TotpController } from '../controllers/TotpController';
import { GoogleAuthController } from '../controllers/GoogleAuthController';
import { SyncGoogleCalendarEventsUseCase } from '../../application/useCases/SyncGoogleCalendarEventsUseCase';
import { validateBody } from '../middlewares/validationMiddleware';
import { asyncHandler } from '../middlewares/asyncHandler';
import { authMiddleware, AuthenticatedRequest } from '../middlewares/authMiddleware';
import { logger } from '../../infrastructure/logger';

const registerSchema = z.object({
    name: z.string().min(2, 'Nome deve ter no mínimo 2 caracteres'),
    email: z.string().email('Email inválido'),
    password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres')
});

const loginSchema = z.object({
    email: z.string().email('Email inválido'),
    password: z.string().min(1, 'Senha é obrigatória')
});

const refreshSchema = z.object({
    refreshToken: z.string().uuid('Refresh token inválido (esperado UUID)')
});

const totpTokenSchema = z.object({
    token: z.string().length(6, 'Código TOTP deve ter 6 dígitos').or(z.string().length(8, 'Código de backup deve ter 8 caracteres'))
});

export function createAuthRoutes(): Router {
    const router = Router();
    const controller = container.resolve(AuthController);
    const totpController = container.resolve(TotpController);

    router.post('/register', validateBody(registerSchema), asyncHandler((req, res) => controller.register(req, res)));
    router.post('/login', validateBody(loginSchema), asyncHandler((req, res) => controller.login(req, res)));
    router.post('/refresh', validateBody(refreshSchema), asyncHandler((req, res) => controller.refresh(req, res)));

    // 2FA — requer JWT válido
    router.post('/2fa/setup', authMiddleware, asyncHandler((req, res) => totpController.setup(req, res)));
    router.post('/2fa/verify', authMiddleware, validateBody(totpTokenSchema), asyncHandler((req, res) => totpController.verify(req, res)));
    router.post('/2fa/disable', authMiddleware, validateBody(totpTokenSchema), asyncHandler((req, res) => totpController.disable(req, res)));

    // Google Calendar OAuth
    const googleAuthController = container.resolve(GoogleAuthController);
    router.get('/google/auth-url', authMiddleware, asyncHandler((req, res) => googleAuthController.getAuthUrl(req, res)));
    router.get('/google/connect', authMiddleware, (req, res) => googleAuthController.connect(req, res));
    router.get('/google/callback', asyncHandler((req, res) => googleAuthController.callback(req, res)));
    router.get('/google/status', authMiddleware, asyncHandler((req, res) => googleAuthController.status(req, res)));
    router.delete('/google/disconnect', authMiddleware, asyncHandler((req, res) => googleAuthController.disconnect(req, res)));

    router.post('/google/sync', authMiddleware, asyncHandler(async (req, res) => {
        const tenantId = (req as AuthenticatedRequest).tenantId;
        if (!tenantId) {
            return res.status(401).json({ error: 'Tenant não identificado' });
        }
        const syncUseCase = container.resolve(SyncGoogleCalendarEventsUseCase);
        // O sync completo pode levar dezenas de segundos e estourar o timeout do
        // gateway. Disparamos em background e respondemos imediatamente (202).
        syncUseCase.executeForTenant(tenantId).catch(err => {
            logger.error({ err, tenantId }, 'Falha no sync manual do Google Calendar (background)');
        });
        return res.status(202).json({ ok: true, message: 'Sincronização iniciada' });
    }));

    return router;
}
