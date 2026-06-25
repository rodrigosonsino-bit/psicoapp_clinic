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
}
