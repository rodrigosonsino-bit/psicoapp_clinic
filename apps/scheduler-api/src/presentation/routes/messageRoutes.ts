import { Router } from 'express';
import { Pool } from 'pg';
import IORedis from 'ioredis';
import { MessageController } from '../controllers/MessageController';
import { TelegramClient } from '../../infrastructure/telegram/TelegramClient';
import { ScheduleMessageUseCase } from '../../application/useCases/ScheduleMessageUseCase';
import { UpdateMessageUseCase } from '../../application/useCases/UpdateMessageUseCase';
import { ListMessagesUseCase } from '../../application/useCases/ListMessagesUseCase';
import { DeleteMessageUseCase } from '../../application/useCases/DeleteMessageUseCase';
import { WeeklyReportUseCase } from '../../application/useCases/WeeklyReportUseCase';
import { PostgresMessageRepository } from '../../infrastructure/repositories/PostgresMessageRepository';
import { BullMQMessageScheduler } from '../../infrastructure/queue/BullMQMessageScheduler';
import { z } from 'zod';
import { authMiddleware } from '../middlewares/authMiddleware';
import { createTrialCheckMiddleware } from '../middlewares/trialCheckMiddleware';
import { validateBody } from '../middlewares/validationMiddleware';

const scheduleMessageSchema = z.object({
    recipientId: z.string().min(1, 'Destinatário é obrigatório'),
    recipientName: z.string().optional(),
    content: z.string().min(1, 'O conteúdo da mensagem não pode estar vazio'),
    sendAt: z.string().datetime({ message: 'Data de disparo inválida (deve ser ISO 8601)' }),
    platform: z.enum(['whatsapp', 'telegram']).default('whatsapp'),
    recurrence: z.string().optional(),
    metadata: z.record(z.string(), z.any()).optional().nullable(),
    imageBase64: z.string().optional()
});

const updateMessageSchema = scheduleMessageSchema.partial();

export function createMessageRoutes(dbPool: Pool, redisConnection: IORedis, telegramClient: TelegramClient): Router {
    const router = Router();
    
    router.use(authMiddleware);
    router.use(createTrialCheckMiddleware(dbPool));
    
    const messageRepository = new PostgresMessageRepository(dbPool);
    const messageScheduler = new BullMQMessageScheduler(redisConnection);
    
    // Injeta nos UseCases
    const scheduleMessageUseCase = new ScheduleMessageUseCase(messageRepository, messageScheduler);
    const updateMessageUseCase = new UpdateMessageUseCase(messageRepository, messageScheduler);
    const listMessagesUseCase = new ListMessagesUseCase(messageRepository);
    const deleteMessageUseCase = new DeleteMessageUseCase(messageRepository, messageScheduler);
    const weeklyReportUseCase = new WeeklyReportUseCase(messageRepository);
    
    const messageController = new MessageController(
        scheduleMessageUseCase, 
        listMessagesUseCase, 
        deleteMessageUseCase, 
        updateMessageUseCase,
        weeklyReportUseCase
    );

    // Rotas
    router.post('/messages', validateBody(scheduleMessageSchema), (req, res) => messageController.schedule(req, res));
    router.get('/messages', (req, res) => messageController.list(req, res));
    router.get('/messages/report/weekly', (req, res) => messageController.weeklyReport(req, res));
    router.patch('/messages/:id', validateBody(updateMessageSchema), (req, res) => messageController.update(req, res));
    router.delete('/messages/:id', (req, res) => messageController.delete(req, res));

    return router;
}
