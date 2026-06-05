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
import { PostgresMessageRepository } from './infrastructure/repositories/PostgresMessageRepository';
import { SyncGoogleCalendarUseCase } from './application/useCases/SyncGoogleCalendarUseCase';
import { GoogleCalendarController } from './presentation/controllers/GoogleCalendarController';
import { createGoogleRoutes } from './presentation/routes/googleRoutes';
import { GeminiClient } from './infrastructure/gemini/GeminiClient';
import { AISecretaryController } from './presentation/controllers/AISecretaryController';
import { createAIRoutes } from './presentation/routes/aiRoutes';
import { BullMQMessageScheduler } from './infrastructure/queue/BullMQMessageScheduler';

import helmet from 'helmet';
import { StripeService } from './infrastructure/stripe/StripeService';
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
    
    app.use(helmet({ contentSecurityPolicy: false }));
    
    const origins = process.env.ALLOWED_ORIGINS?.split(',');
    if (process.env.NODE_ENV === 'production' && !origins) {
        throw new Error('ALLOWED_ORIGINS obrigatório em produção');
    }
    app.use(cors({ origin: origins || '*' }));
    
    // Configurar Stripe webhook com express.raw ANTES do express.json
    const stripeService = new StripeService(dbPool);
    const billingController = new BillingController(dbPool, stripeService);
    
    app.post('/api/billing/webhook', webhookLimiter, express.raw({ type: 'application/json' }), billingController.handleWebhook);
    
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
    const googleController = new GoogleCalendarController(googleClient, googleSyncUseCase);
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
