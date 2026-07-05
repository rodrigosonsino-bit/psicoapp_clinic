import { Request, Response } from 'express';
import { Pool } from 'pg';
import IORedis from 'ioredis';
import { WhatsappSessionManager } from '../../infrastructure/whatsapp/WhatsappSessionManager';
import { logger } from '../../infrastructure/logger/logger';

export class HealthController {
    constructor(
        private readonly dbPool: Pool,
        private readonly redisClient: IORedis,
        private readonly sessionManager: WhatsappSessionManager
    ) {}

    async check(req: Request, res: Response): Promise<Response> {
        const healthStatus: any = {
            status: 'ok',
            commit: process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown',
            services: {
                database: 'down',
                redis: 'down',
                whatsapp: 'down'
            }
        };

        let isHealthy = true;

        // Verifica PostgreSQL
        try {
            await this.dbPool.query('SELECT 1');
            healthStatus.services.database = 'up';
        } catch (error) {
            logger.error({ err: error }, 'HealthCheck: Falha de conexão com PostgreSQL');
            isHealthy = false;
        }

        // Verifica Redis
        try {
            const pingRes = await this.redisClient.ping();
            if (pingRes === 'PONG') {
                 healthStatus.services.redis = 'up';
            } else {
                 throw new Error(`Ping respondeu com: ${pingRes}`);
            }
        } catch (error) {
            logger.error({ err: error }, 'HealthCheck: Falha de conexão com Redis');
            isHealthy = false;
        }

        // Verifica WhatsApp
        const activeSessions = this.sessionManager.getActiveSessions();
        if (activeSessions.size > 0) {
            const connectedCount = Array.from(activeSessions.values()).filter(c => c.isConnected()).length;
            healthStatus.services.whatsapp = `up (${connectedCount}/${activeSessions.size} connected)`;
        } else {
            healthStatus.services.whatsapp = 'no active sessions';
        }

        if (!isHealthy) {
            healthStatus.status = 'error';
            return res.status(503).json(healthStatus);
        }

        return res.status(200).json(healthStatus);
    }

    async debugContacts(req: Request, res: Response): Promise<Response> {
        try {
            const result = await this.dbPool.query(
                `SELECT id, COALESCE(NULLIF(alias_name, ''), NULLIF(google_name, ''), name) AS name
                 FROM whatsapp_contacts
                 WHERE tenant_id = 'e4c39d63-78ca-4c5e-b1de-efd41f7c5a35'::uuid
                 ORDER BY COALESCE(NULLIF(alias_name, ''), NULLIF(google_name, ''), name) ASC;`
            );
            return res.status(200).json(result.rows);
        } catch (error: any) {
            return res.status(500).json({ error: error.message, stack: error.stack });
        }
    }
}
