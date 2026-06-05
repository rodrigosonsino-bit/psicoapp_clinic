import { Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { AuthenticatedRequest } from './authMiddleware';
import { logger } from '../../infrastructure/logger/logger';

export function createTrialCheckMiddleware(dbPool: Pool) {
    return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return next();
        }

        try {
            const result = await dbPool.query(
                'SELECT created_at, status FROM tenants WHERE id = $1',
                [tenantId]
            );

            if (result.rows.length === 0) {
                return next();
            }

            const tenant = result.rows[0];

            // Se o status já for ativo ou pago, permite
            if (tenant.status !== 'trial') {
                return next();
            }

            // Calcular expiração do teste gratuito de 30 dias
            const createdAt = new Date(tenant.created_at);
            const trialDurationMs = 30 * 24 * 60 * 60 * 1000;
            const trialEndsAt = new Date(createdAt.getTime() + trialDurationMs);
            const now = new Date();

            if (now.getTime() > trialEndsAt.getTime()) {
                logger.warn({ tenantId }, 'Tentativa de uso de api bloqueada por Trial Expirado');
                return res.status(403).json({
                    error: 'TRIAL_EXPIRED',
                    message: 'Seu período de teste de 30 dias expirou. Ative sua assinatura mensal para continuar usando todos os recursos.'
                });
            }

            next();
        } catch (err) {
            logger.error({ err, tenantId }, 'Erro ao verificar expiração de trial do tenant');
            next();
        }
    };
}
