import { Router } from 'express';
import { Pool } from 'pg';
import { WhatsappSessionManager } from '../../infrastructure/whatsapp/WhatsappSessionManager';
import { WhatsappController } from '../controllers/WhatsappController';
import { authMiddleware } from '../middlewares/authMiddleware';
import { createTrialCheckMiddleware } from '../middlewares/trialCheckMiddleware';

export function createWhatsappRoutes(sessionManager: WhatsappSessionManager, dbPool: Pool): Router {
    const router = Router();
    const controller = new WhatsappController(sessionManager, dbPool);

    router.use(authMiddleware);
    router.use(createTrialCheckMiddleware(dbPool));

    router.post('/whatsapp/connect', controller.connect);
    router.get('/whatsapp/status', controller.getStatus);
    router.post('/whatsapp/disconnect', controller.disconnect);
    router.get('/whatsapp/qr', controller.getQr);
    router.get('/whatsapp/groups', controller.getGroups);
    router.get('/whatsapp/contacts', controller.getContacts);
    router.post('/whatsapp/pairing-code', controller.getPairingCode);

    return router;
}
