import { Router } from 'express';
import { Pool } from 'pg';
import IORedis from 'ioredis';
import { HealthController } from '../controllers/HealthController';
import { WhatsappSessionManager } from '../../infrastructure/whatsapp/WhatsappSessionManager';

export function createHealthRoutes(dbPool: Pool, redisConnection: IORedis, sessionManager: WhatsappSessionManager): Router {
    const router = Router();
    const healthController = new HealthController(dbPool, redisConnection, sessionManager);

    router.get('/health', (req, res) => healthController.check(req, res));

    return router;
}
