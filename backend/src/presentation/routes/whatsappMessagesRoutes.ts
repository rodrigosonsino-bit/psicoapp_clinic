import { Router, RequestHandler } from 'express';
import { WhatsappMessagesController } from '../controllers/WhatsappMessagesController';
import { IWhatsappCloudRepository } from '../../domain/repositories/IWhatsappCloudRepository';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';
import { WhatsappCloudClient } from '../../infrastructure/whatsappCloud/WhatsappCloudClient';
import { authMiddleware } from '../middlewares/authMiddleware';
import { asyncHandler } from '../middlewares/asyncHandler';

export function createWhatsappMessagesRoutes(
    repository: IWhatsappCloudRepository,
    psychotherapyRepository: IPsychotherapyRepository,
    cloudClient: WhatsappCloudClient | null,
    pollRateLimit?: RequestHandler
): Router {
    const router = Router();
    const controller = new WhatsappMessagesController(repository, psychotherapyRepository, cloudClient);
    const pollMiddlewares = pollRateLimit ? [authMiddleware, pollRateLimit] : [authMiddleware];

    router.get('/psychotherapy/whatsapp-messages/unseen', ...pollMiddlewares, asyncHandler(controller.listUnseen));
    router.get('/psychotherapy/patients/:patientId/whatsapp-messages', ...pollMiddlewares, asyncHandler(controller.listForPatient));
    router.post('/psychotherapy/patients/:patientId/whatsapp-messages', authMiddleware, asyncHandler(controller.sendReply));

    return router;
}
