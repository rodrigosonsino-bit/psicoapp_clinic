import { Router } from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { container } from '../../container';
import { AuthController } from '../controllers/AuthController';
import { TotpController } from '../controllers/TotpController';
import { GoogleAuthController } from '../controllers/GoogleAuthController';
import { GmailAuthController } from '../controllers/GmailAuthController';
import { SyncGoogleCalendarEventsUseCase } from '../../application/useCases/SyncGoogleCalendarEventsUseCase';
import { validateBody } from '../middlewares/validationMiddleware';
import { asyncHandler } from '../middlewares/asyncHandler';
import { authMiddleware, AuthenticatedRequest } from '../middlewares/authMiddleware';
import { pending2faMiddleware } from '../middlewares/pending2faMiddleware';
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

/**
 * Brute-force guard dedicado às rotas de autenticação sensíveis (login / verificação de 2FA).
 * Mais estrito que o rate limit global do server.ts (300/15min, compartilhado com TODA a API) —
 * ali um atacante teria centenas de tentativas de senha antes de qualquer bloqueio.
 *
 * - `skipSuccessfulRequests: true` → só tentativas que FALHAM consomem a cota. O usuário legítimo
 *   que acerta a senha nunca é penalizado; quem fica errando (brute-force/credential-stuffing) é.
 * - Chave = IP + identidade. Identidade é `req.tenantId` (validado por `authMiddleware`/
 *   `pending2faMiddleware`, que precisam rodar ANTES deste limiter na rota) quando disponível —
 *   preferível ao email do corpo porque é uma identidade autenticada, não um dado que o próprio
 *   atacante controla. Em `/login` (pré-auth, sem tenantId ainda) cai pro email do corpo. Sem
 *   nenhum dos dois, cai só pra IP.
 * - `trust proxy` em server.ts é parametrizado via `TRUST_PROXY_HOPS` (não mais `true`
 *   incondicional) — `req.ip` confia só no número de hops configurado, evitando que o
 *   próprio cliente forje `X-Forwarded-For` pra falsificar IP e contornar este rate limit.
 */
const loginRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    limit: 10,
    skipSuccessfulRequests: true,
    skip: () => process.env.NODE_ENV === 'test',
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false },
    keyGenerator: (req) => {
        const ipKey = ipKeyGenerator(req.ip ?? '');
        const tenantId = (req as AuthenticatedRequest).tenantId;
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const identity = tenantId || email;
        return identity ? `${ipKey}:${identity}` : ipKey;
    },
    handler: (_req, res) => {
        res.status(429).json({
            error: 'Muitas tentativas de login. Tente novamente em alguns minutos.'
        });
    }
});

/**
 * Segunda camada, só de IP, sem `skipSuccessfulRequests` — pega o padrão que o limiter por
 * IP+identidade sozinho não pega: um atacante variando o e-mail a cada tentativa (list
 * spraying/credential stuffing distribuído por conta, mas concentrado num IP). Limite mais alto
 * (30/15min) porque cobre todo tráfego de auth do IP, não só falhas de uma conta específica —
 * não deve incomodar uso legítimo normal.
 */
const loginIpOnlyRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    skip: () => process.env.NODE_ENV === 'test',
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false },
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
    handler: (_req, res) => {
        res.status(429).json({
            error: 'Muitas tentativas de login. Tente novamente em alguns minutos.'
        });
    }
});

export function createAuthRoutes(): Router {
    const router = Router();
    const controller = container.resolve(AuthController);
    const totpController = container.resolve(TotpController);

    router.post('/register', validateBody(registerSchema), asyncHandler((req, res) => controller.register(req, res)));
    router.post('/login', loginIpOnlyRateLimit, loginRateLimit, validateBody(loginSchema), asyncHandler((req, res) => controller.login(req, res)));
    // pending2faMiddleware roda ANTES do rate limit de propósito: ele valida o token de desafio e
    // popula req.tenantId, que o loginRateLimit usa como chave de identidade (em vez de cair pra
    // só-IP, que penalizaria todo mundo atrás do mesmo IP/NAT por uma conta só sendo atacada).
    router.post('/2fa/login', pending2faMiddleware, loginRateLimit, validateBody(totpTokenSchema), asyncHandler((req, res) => controller.login2fa(req, res)));
    router.post('/refresh', validateBody(refreshSchema), asyncHandler((req, res) => controller.refresh(req, res)));

    // 2FA — requer JWT válido
    router.post('/2fa/setup', authMiddleware, asyncHandler((req, res) => totpController.setup(req, res)));
    router.post('/2fa/verify', authMiddleware, loginRateLimit, validateBody(totpTokenSchema), asyncHandler((req, res) => totpController.verify(req, res)));
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

    // Gmail (extrato bancário via e-mail) OAuth — conexão dedicada, separada do Calendar
    const gmailAuthController = container.resolve(GmailAuthController);
    router.get('/gmail/auth-url', authMiddleware, asyncHandler((req, res) => gmailAuthController.getAuthUrl(req, res)));
    router.get('/gmail/callback', asyncHandler((req, res) => gmailAuthController.callback(req, res)));
    router.get('/gmail/status', authMiddleware, asyncHandler((req, res) => gmailAuthController.status(req, res)));
    router.delete('/gmail/disconnect', authMiddleware, asyncHandler((req, res) => gmailAuthController.disconnect(req, res)));

    return router;
}
