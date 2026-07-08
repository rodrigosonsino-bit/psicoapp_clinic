import { Router } from 'express';
import { WhatsappMessagesController } from '../controllers/WhatsappMessagesController';
import { IWhatsappCloudRepository } from '../../domain/repositories/IWhatsappCloudRepository';
import { authMiddleware } from '../middlewares/authMiddleware';
import { asyncHandler } from '../middlewares/asyncHandler';

export function createWhatsappMessagesRoutes(repository: IWhatsappCloudRepository): Router {
    const router = Router();
    const controller = new WhatsappMessagesController(repository);

    router.get('/psychotherapy/patients/:patientId/whatsapp-messages', authMiddleware, asyncHandler(controller.listForPatient));

    return router;
}
