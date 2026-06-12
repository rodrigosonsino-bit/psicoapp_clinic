import { Router } from 'express';
import { z } from 'zod';
import { container } from '../../container';
import { AuthController } from '../controllers/AuthController';
import { TotpController } from '../controllers/TotpController';
import { GoogleAuthController } from '../controllers/GoogleAuthController';
import { validateBody } from '../middlewares/validationMiddleware';
import { asyncHandler } from '../middlewares/asyncHandler';
import { authMiddleware } from '../middlewares/authMiddleware';

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

    return router;
}
