import 'reflect-metadata';
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { rateLimit } from 'express-rate-limit';
import { createPsychotherapyRoutes } from './presentation/routes/psychotherapyRoutes';
import { createAuthRoutes } from './presentation/routes/authRoutes';
import { createHealthRoutes } from './presentation/routes/healthRoutes';
import { createWhatsappRoutes } from './presentation/routes/whatsappRoutes';
import { errorHandler } from './presentation/middlewares/errorMiddleware';
import { logger } from './infrastructure/logger';
import { container } from './container';
import { Pool } from 'pg';
import { ReminderScheduler } from './infrastructure/scheduler/ReminderScheduler';
import { SyncGoogleCalendarEventsUseCase } from './application/useCases/SyncGoogleCalendarEventsUseCase';
import { GoogleCalendarSyncJob } from './infrastructure/scheduler/GoogleCalendarSyncJob';
import { IPsychotherapyRepository } from './domain/repositories/IPsychotherapyRepository';
import { PixController } from './presentation/controllers/PixController';
import { WhatsappSessionManager } from '@antigravity/whatsapp-core';
import { createPaymentReceiptHandler } from './infrastructure/whatsapp/PaymentReceiptHandler';

const app = express();
const PORT = Number(process.env.PORT) || 3333;

// Confia no cabeçalho X-Forwarded-For do Railway/proxy para o rate limiter funcionar
app.set('trust proxy', true);

// ── Rate Limiters ────────────────────────────────────────────────────────────

// Camada 1: Rate limit global para toda a API (/api)
const globalRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    limit: 300,
    skip: () => process.env.NODE_ENV === 'test',
    validate: { trustProxy: false },
    handler: (_req, res) => {
        res.status(429).json({
            error: 'Muitas requisições. Tente novamente em alguns minutos.'
        });
    }
});

// Camada 2: Rate limit estrito para rotas que criam ou modificam dados (POST, PUT, DELETE) sob o prefixo /api
const strictRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    limit: 200,
    skip: (req) => process.env.NODE_ENV === 'test' || !['POST', 'PUT', 'DELETE'].includes(req.method),
    validate: { trustProxy: false },
    handler: (_req, res) => {
        res.status(429).json({
            error: 'Muitas requisições. Tente novamente em alguns minutos.'
        });
    }
});

// ── Middlewares globais ─────────────────────────────────────────────────────

// Configure Helmet with secure CSP instead of disabling it
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'"]
        }
    }
}));

// Restrict CORS via environment variable (fallback to Vite dev server port).
// Accepts a comma-separated allowlist for dev + deployed frontend origins.
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
const allowedCorsOrigins =
    corsOrigin === '*'
        ? '*'
        : corsOrigin
              .split(',')
              .map(origin => origin.trim())
              .filter(Boolean);
app.use(cors({
    origin: allowedCorsOrigins,
    credentials: true
}));

// Aplicado apenas sobre '/api' para não bloquear o frontend estático nem as rotas de health check
app.use('/api', globalRateLimit);

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Rotas de autenticação sem rate limit restrito (cobertas pelo rate limit global)
app.use('/auth', globalRateLimit, createAuthRoutes());

// Aplicado apenas em escritas (POST/PUT/DELETE) sob o prefixo '/api'
app.use('/api', strictRateLimit);

app.use('/api', createPsychotherapyRoutes());

// WhatsApp integration routes
const whatsappSessionManager = container.resolve<WhatsappSessionManager>('WhatsappSessionManager');
const dbPool = container.resolve(Pool);
app.use('/api', createWhatsappRoutes(whatsappSessionManager, dbPool));

// Webhook Pix — rota pública (sem auth JWT), valida via header da Efí Bank
app.post('/webhooks/pix', express.json(), (req, res) => {
    const pixController = container.resolve(PixController);
    pixController.handleWebhook(req, res).catch(() => res.status(200).json({ ok: true }));
});

app.use(createHealthRoutes());

app.get('*', (_req, res) => {
    const indexPath = path.join(__dirname, '..', 'public', 'index.html');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    if (require('fs').existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

app.use(errorHandler);

// Bootstrap process: Only connect to the DB and listen to the port when run directly
if (require.main === module) {
    const dbPool = container.resolve(Pool);
    const shouldBootWhatsapp =
        process.env.DISABLE_WHATSAPP_BOOT !== 'true' &&
        process.env.ENABLE_WHATSAPP !== 'false';
    
    logger.info('⏳ Testando conexão com o banco de dados...');
    dbPool.query('SELECT 1')
        .then(() => {
            logger.info('✅ Banco de dados conectado com sucesso.');
            app.listen(PORT, () => {
                logger.info(`🚀 Psychotherapy Backend rodando em http://localhost:${PORT}`);

                // Inicializar WhatsApp (opcional — só se ENABLE_WHATSAPP não for false)
                const sessionManager = container.resolve<WhatsappSessionManager>('WhatsappSessionManager');
                if (shouldBootWhatsapp) {
                    const dbPool = container.resolve(Pool);
                    const receiptHandler = createPaymentReceiptHandler(dbPool);
                    sessionManager.initializeAll(dbPool, receiptHandler).catch(err => {
                        logger.error({ err }, '⚠️ Falha ao inicializar sessões WhatsApp (não crítico — app continua)');
                    });
                    logger.info('📱 WhatsApp Session Manager inicializado');
                } else {
                    logger.warn('⚠️ WhatsApp boot desativado via ENABLE_WHATSAPP=false ou DISABLE_WHATSAPP_BOOT=true');
                }

                if (process.env.ENABLE_REMINDERS !== 'false') {
                    const repository = container.resolve<IPsychotherapyRepository>('IPsychotherapyRepository');
                    const scheduler = new ReminderScheduler(
                        repository,
                        shouldBootWhatsapp ? sessionManager : undefined
                    );
                    scheduler.start();
                }

                if (process.env.ENABLE_GCAL_SYNC === 'true') {
                    const syncUseCase = container.resolve(SyncGoogleCalendarEventsUseCase);
                    const syncJob = new GoogleCalendarSyncJob(syncUseCase);
                    syncJob.start();
                }
            });
        })
        .catch(err => {
            logger.error({ err }, '❌ Falha ao conectar ao banco de dados durante a inicialização.');
            process.exit(1);
        });
}

export default app;
