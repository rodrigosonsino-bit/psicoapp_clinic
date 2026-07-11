import { Router, raw } from 'express';
import { WhatsappCloudWebhookController } from '../controllers/WhatsappCloudWebhookController';
import { IWhatsappCloudRepository } from '../../domain/repositories/IWhatsappCloudRepository';

/**
 * IMPORTANTE: este router precisa ser registrado em server.ts ANTES de `app.use(express.json())`
 * global. A validação de assinatura (X-Hub-Signature-256) exige os BYTES BRUTOS do corpo — se o
 * express.json() global processar a requisição primeiro, o stream já estará consumido e a
 * assinatura calculada sobre um JSON re-serializado nunca vai bater com a da Meta.
 */
export function createWhatsappCloudWebhookRoutes(repository: IWhatsappCloudRepository): Router {
    const router = Router();
    const controller = new WhatsappCloudWebhookController(repository);

    router.get('/whatsapp-cloud/webhook', controller.verify);
    router.post('/whatsapp-cloud/webhook', raw({ type: 'application/json', limit: '512kb' }), controller.receive);

    return router;
}
