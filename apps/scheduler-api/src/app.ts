import express from 'express';
import cors from 'cors';
import path from 'path';
import { Pool } from 'pg';
import IORedis from 'ioredis';
import { TelegramClient } from './infrastructure/telegram/TelegramClient';
import { createMessageRoutes } from './presentation/routes/messageRoutes';
import { createHealthRoutes } from './presentation/routes/healthRoutes';
import { createAuthRoutes } from './presentation/routes/authRoutes';
import { createWhatsappRoutes } from './presentation/routes/whatsappRoutes';
import { WhatsappSessionManager } from './infrastructure/whatsapp/WhatsappSessionManager';
import { GoogleCalendarClient } from './infrastructure/google/GoogleCalendarClient';
import { GoogleContactsClient } from './infrastructure/google/GoogleContactsClient';
import { PostgresMessageRepository } from './infrastructure/repositories/PostgresMessageRepository';
import { SyncGoogleCalendarUseCase } from './application/useCases/SyncGoogleCalendarUseCase';
import { GoogleCalendarController } from './presentation/controllers/GoogleCalendarController';
import { createGoogleRoutes } from './presentation/routes/googleRoutes';
import { GeminiClient } from './infrastructure/gemini/GeminiClient';
import { AISecretaryController } from './presentation/controllers/AISecretaryController';
import { createAIRoutes } from './presentation/routes/aiRoutes';
import { BullMQMessageScheduler } from './infrastructure/queue/BullMQMessageScheduler';

import helmet from 'helmet';
import { MercadoPagoService } from './infrastructure/payment/MercadoPagoService';
import { BillingController } from './presentation/controllers/BillingController';
import { createBillingRoutes } from './presentation/routes/billingRoutes';
import { globalLimiter, webhookLimiter } from './presentation/middlewares/rateLimitMiddleware';

export function createApp(
    dbPool: Pool, 
    redisConnection: IORedis, 
    sessionManager: WhatsappSessionManager, 
    telegramClient: TelegramClient,
    geminiClient: GeminiClient
): express.Application {
    const app = express();
    
    // Confia no cabeçalho X-Forwarded-For do Railway/proxy para o rate limiter funcionar
    app.set('trust proxy', true);
    
    app.use(helmet({ contentSecurityPolicy: false }));
    
    const rawOrigins = process.env.ALLOWED_ORIGINS;
    if (process.env.NODE_ENV === 'production' && !rawOrigins) {
        throw new Error('ALLOWED_ORIGINS obrigatório em produção');
    }
    const origins = rawOrigins === '*' ? '*' : rawOrigins?.split(',');
    app.use(cors({ origin: origins || '*' }));
    
    // Webhook MP: precisa de express.json parseado (não raw), pois MP não usa verificação de body-hash
    const mpService = new MercadoPagoService(dbPool);
    const billingController = new BillingController(dbPool, mpService);

    app.post('/api/billing/webhook', webhookLimiter, express.json(), billingController.handleWebhook);
    
    app.use('/api', globalLimiter);
    app.use(express.json({ limit: '10mb' }));
    
    // API routes (must come BEFORE static files)
    app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));
    app.use('/api', createHealthRoutes(dbPool, redisConnection, sessionManager));
    app.use('/api', createAuthRoutes(dbPool));
    app.use('/api', createBillingRoutes(billingController));
    // Google Calendar Integration
    const googleClient = new GoogleCalendarClient(dbPool);
    const messageRepository = new PostgresMessageRepository(dbPool);
    const messageScheduler = new BullMQMessageScheduler(redisConnection);
    const googleSyncUseCase = new SyncGoogleCalendarUseCase(googleClient, messageRepository, dbPool, messageScheduler);
    const googleContactsClient = new GoogleContactsClient(dbPool, googleClient);
    const googleController = new GoogleCalendarController(googleClient, googleSyncUseCase, googleContactsClient);
    app.use('/api', createGoogleRoutes(googleController, dbPool));

    app.use('/api', createMessageRoutes(dbPool, redisConnection, telegramClient));
    app.use('/api', createWhatsappRoutes(sessionManager, dbPool));

    // Gemini AI Secretary Integration
    const aiController = new AISecretaryController(geminiClient);
    app.use('/api', createAIRoutes(aiController, dbPool));

    // Serve the Expo web build from /public folder
    const publicPath = path.join(__dirname, '..', 'public');
    app.use(express.static(publicPath));

    // SPA fallback: any non-API route serves index.html
    app.get('*', (req, res) => {
        if (!req.path.startsWith('/api')) {
            res.sendFile(path.join(publicPath, 'index.html'));
        }
    });

    return app;
}
