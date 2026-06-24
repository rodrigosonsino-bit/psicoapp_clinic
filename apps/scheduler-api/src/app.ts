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
import { createTelegramRoutes } from './presentation/routes/telegramRoutes';
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

import { uploadAuthMiddleware } from './presentation/middlewares/uploadAuthMiddleware';

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
    
    // Helmet config: CSP seguro mas leniente para o Expo Web (unsafe-inline/eval) e OAuth
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", "data:", "https:"],
                connectSrc: ["'self'", "https:", "wss:"],
                fontSrc: ["'self'", "data:", "https:"],
                frameSrc: ["'self'", "https://accounts.google.com/"],
            }
        },
        crossOriginEmbedderPolicy: false // Importante: true quebra carregamento de imagens externas
    }));
    
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
    app.use('/uploads', uploadAuthMiddleware, (req, res, next) => {
        const authReq = req as any;
        const requestedPath = req.path; // ex: "/[tenantId]/arquivo.ogg"
        const requestedTenantId = requestedPath.split('/')[1];
        
        if (authReq.tenantId !== requestedTenantId) {
            return res.status(403).json({ error: 'Acesso negado aos arquivos deste tenant' });
        }
        next();
    }, express.static(path.join(__dirname, '../public/uploads')));
    app.use('/api', createHealthRoutes(dbPool, redisConnection, sessionManager));
    app.use('/api', createAuthRoutes(dbPool));
    app.use('/api', createBillingRoutes(billingController));
    // Google Calendar Integration
    const googleClient = new GoogleCalendarClient(dbPool);
    const messageRepository = new PostgresMessageRepository(dbPool);
    const messageScheduler = new BullMQMessageScheduler(redisConnection);
    const googleSyncUseCase = new SyncGoogleCalendarUseCase(googleClient, messageRepository, dbPool, messageScheduler, sessionManager);
    const googleContactsClient = new GoogleContactsClient(dbPool, googleClient);
    const googleController = new GoogleCalendarController(googleClient, googleSyncUseCase, googleContactsClient);
    app.use('/api', createGoogleRoutes(googleController, dbPool));

    app.use('/api', createMessageRoutes(dbPool, redisConnection, telegramClient));
    app.use('/api', createWhatsappRoutes(sessionManager, dbPool));
    app.use('/api', createTelegramRoutes(telegramClient));

    // Gemini AI Secretary Integration
    const aiController = new AISecretaryController(geminiClient);
    app.use('/api', createAIRoutes(aiController, dbPool));

    // Serve the Expo web build from /public folder
    if (process.env.SERVE_STATIC_SPA !== 'false') {
        const publicPath = path.join(__dirname, '..', 'public');
        app.use(express.static(publicPath));

        // SPA fallback: any non-API and non-uploads route serves index.html
        app.get('*', (req, res) => {
            if (!req.path.startsWith('/api') && !req.path.startsWith('/uploads')) {
                res.sendFile(path.join(publicPath, 'index.html'));
            } else {
                res.status(404).json({ error: 'Endpoint ou arquivo não encontrado' });
            }
        });
    } else {
        app.get('*', (req, res) => {
            res.status(404).json({ error: 'Endpoint não encontrado (SPA desativado)' });
        });
    }

    return app;
}
