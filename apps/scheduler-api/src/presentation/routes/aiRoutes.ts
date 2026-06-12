import { Router } from 'express';
import { Pool } from 'pg';
import { AISecretaryController } from '../controllers/AISecretaryController';
import { authMiddleware } from '../middlewares/authMiddleware';
import { createTrialCheckMiddleware } from '../middlewares/trialCheckMiddleware';

export function createAIRoutes(controller: AISecretaryController, dbPool: Pool): Router {
    const router = Router();

    router.use(authMiddleware);
    router.use(createTrialCheckMiddleware(dbPool));

    router.post('/ai/secretary', controller.handlePrompt.bind(controller));
    router.get('/ai/settings', controller.getSettings.bind(controller));
    router.post('/ai/settings', controller.saveSettings.bind(controller));

    return router;
}
