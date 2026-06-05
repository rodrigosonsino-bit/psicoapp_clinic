import { Router } from 'express';
import { Pool } from 'pg';
import { z } from 'zod';
import { JwtService } from '../../infrastructure/auth/JwtService';
import { logger } from '../../infrastructure/logger/logger';
import { authMiddleware, AuthenticatedRequest } from '../middlewares/authMiddleware';
import { validateBody } from '../middlewares/validationMiddleware';
import { authLimiter } from '../middlewares/rateLimitMiddleware';

const registerSchema = z.object({
    name: z.string().min(2, 'O nome deve ter pelo menos 2 caracteres'),
    email: z.string().email('Formato de e-mail inválido'),
    password: z.string().min(6, 'A senha deve ter pelo menos 6 caracteres')
});

const loginSchema = z.object({
    email: z.string().email('Formato de e-mail inválido'),
    password: z.string().min(1, 'A senha é obrigatória')
});

export function createAuthRoutes(dbPool: Pool): Router {
    const router = Router();
    const jwtService = new JwtService();

    router.post('/auth/register', authLimiter, validateBody(registerSchema), async (req, res) => {
        try {
            const { name, email, password } = req.body;
            if (!name || !email || !password) {
                return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
            }

            const passwordHash = await JwtService.hashPassword(password);

            const result = await dbPool.query(
                `INSERT INTO tenants (name, email, password_hash)
                 VALUES ($1, $2, $3) RETURNING id, plan`,
                [name, email, passwordHash]
            );

            const tenant = result.rows[0];
            const token = jwtService.generateToken({ tenantId: tenant.id, email, plan: tenant.plan });

            res.status(201).json({ token, tenantId: tenant.id, plan: tenant.plan });
        } catch (err: any) {
            if (err.code === '23505') { // unique violation in Postgres
                return res.status(409).json({ error: 'Email já cadastrado' });
            }
            logger.error({ err }, 'Erro no registro de tenant');
            res.status(500).json({ error: 'Erro interno ao registrar' });
        }
    });

    router.post('/auth/login', authLimiter, validateBody(loginSchema), async (req, res) => {
        try {
            const { email, password } = req.body;
            if (!email || !password) {
                return res.status(400).json({ error: 'Email e senha são obrigatórios' });
            }

            const result = await dbPool.query('SELECT id, password_hash, plan FROM tenants WHERE email = $1', [email]);
            const tenant = result.rows[0];

            if (!tenant) {
                return res.status(401).json({ error: 'Credenciais inválidas' });
            }

            const isValid = await JwtService.comparePassword(password, tenant.password_hash);
            if (!isValid) {
                return res.status(401).json({ error: 'Credenciais inválidas' });
            }

            const token = jwtService.generateToken({ tenantId: tenant.id, email, plan: tenant.plan });
            res.json({ token, tenantId: tenant.id, plan: tenant.plan });
        } catch (err) {
            logger.error({ err }, 'Erro no login de tenant');
            res.status(500).json({ error: 'Erro interno ao fazer login' });
        }
    });

    router.get('/auth/me', authMiddleware, async (req: AuthenticatedRequest, res) => {
        try {
            const result = await dbPool.query(
                'SELECT id, name, email, plan, status, max_messages_per_month, whatsapp_connected, created_at FROM tenants WHERE id = $1',
                [req.tenantId]
            );
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Tenant não encontrado' });
            }
            const tenant = result.rows[0];

            // Calcular dias restantes do trial de 30 dias
            const createdAt = new Date(tenant.created_at);
            const trialDurationMs = 30 * 24 * 60 * 60 * 1000;
            const trialEndsAt = new Date(createdAt.getTime() + trialDurationMs);
            const now = new Date();
            
            let trialDaysRemaining = Math.ceil((trialEndsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
            trialDaysRemaining = Math.max(0, trialDaysRemaining);
            
            const isTrialExpired = tenant.status === 'trial' && trialDaysRemaining <= 0;

            res.json({
                ...tenant,
                trialDaysRemaining,
                isTrialExpired
            });
        } catch (err) {
            logger.error({ err }, 'Erro ao buscar dados do tenant');
            res.status(500).json({ error: 'Erro interno ao buscar perfil' });
        }
    });
    return router;
}
