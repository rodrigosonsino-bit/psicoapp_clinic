import { Router } from 'express';
import { Pool } from 'pg';
import { WhatsappController } from '../controllers/WhatsappController';
import { authMiddleware } from '../middlewares/authMiddleware';
import { WhatsappSessionManager } from '@antigravity/whatsapp-core';

export function createWhatsappRoutes(sessionManager: WhatsappSessionManager, dbPool: Pool): Router {
    const router = Router();
    const controller = new WhatsappController(sessionManager, dbPool);

    // Todas as rotas requerem autenticação
    router.use(authMiddleware);

    // GET  /api/whatsapp/status    → status da conexão do tenant
    router.get('/whatsapp/status', controller.getStatus);

    // POST /api/whatsapp/connect   → inicializa sessão / gera QR
    router.post('/whatsapp/connect', controller.connect);

    // POST /api/whatsapp/disconnect → encerra sessão
    router.post('/whatsapp/disconnect', controller.disconnect);

    // DELETE /api/whatsapp/session  → limpa sessão (banco + memória) forçadamente
    router.delete('/whatsapp/session', controller.clearSession);

    // GET  /api/whatsapp/qr        → retorna QR code como base64 data URL
    router.get('/whatsapp/qr', controller.getQr);

    // POST /api/whatsapp/pairing-code → gera código de pareamento por número
    router.post('/whatsapp/pairing-code', controller.getPairingCode);

    return router;
}
