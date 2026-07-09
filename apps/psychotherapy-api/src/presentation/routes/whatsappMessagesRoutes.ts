import { Router } from 'express';
import { WhatsappMessagesController } from '../controllers/WhatsappMessagesController';
import { IWhatsappCloudRepository } from '../../domain/repositories/IWhatsappCloudRepository';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';
import { WhatsappCloudClient } from '../../infrastructure/whatsappCloud/WhatsappCloudClient';
import { authMiddleware } from '../middlewares/authMiddleware';
import { asyncHandler } from '../middlewares/asyncHandler';

export function createWhatsappMessagesRoutes(
    repository: IWhatsappCloudRepository,
    psychotherapyRepository: IPsychotherapyRepository,
    cloudClient: WhatsappCloudClient | null
): Router {
    const router = Router();
    const controller = new WhatsappMessagesController(repository, psychotherapyRepository, cloudClient);

    router.get('/psychotherapy/patients/:patientId/whatsapp-messages', authMiddleware, asyncHandler(controller.listForPatient));
    router.post('/psychotherapy/patients/:patientId/whatsapp-messages', authMiddleware, asyncHandler(controller.sendReply));

    return router;
}
