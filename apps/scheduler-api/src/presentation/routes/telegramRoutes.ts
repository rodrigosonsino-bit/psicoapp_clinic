import { Router } from 'express';
import { TelegramClient } from '../../infrastructure/telegram/TelegramClient';
import { TelegramController } from '../controllers/TelegramController';
import { authMiddleware } from '../middlewares/authMiddleware';

export function createTelegramRoutes(telegramClient: TelegramClient): Router {
    const router = Router();
    const controller = new TelegramController(telegramClient);

    router.use(authMiddleware);
    router.get('/telegram/status', controller.getStatus);

    return router;
}
