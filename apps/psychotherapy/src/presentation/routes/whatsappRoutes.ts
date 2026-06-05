import { Router } from 'express';
import { WhatsappController } from '../controllers/WhatsappController';
import { authMiddleware } from '../middlewares/authMiddleware';
import { WhatsappSessionManager } from '@antigravity/whatsapp-core';

export function createWhatsappRoutes(sessionManager: WhatsappSessionManager): Router {
    const router = Router();
    const controller = new WhatsappController(sessionManager);

    // Todas as rotas requerem autenticação
    router.use(authMiddleware);

    // GET  /api/whatsapp/status    → status da conexão do tenant
    router.get('/whatsapp/status', controller.getStatus);

    // POST /api/whatsapp/connect   → inicializa sessão / gera QR
    router.post('/whatsapp/connect', controller.connect);

    // POST /api/whatsapp/disconnect → encerra sessão
    router.post('/whatsapp/disconnect', controller.disconnect);

    // GET  /api/whatsapp/qr        → retorna QR code como base64 data URL
    router.get('/whatsapp/qr', controller.getQr);

    // POST /api/whatsapp/pairing-code → gera código de pareamento por número
    router.post('/whatsapp/pairing-code', controller.getPairingCode);

    return router;
}
