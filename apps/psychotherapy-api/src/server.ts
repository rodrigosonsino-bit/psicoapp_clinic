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
import nodeCron from 'node-cron';
import { reconcilePixCharges } from './scripts/reconcilePixCharges';
import { EmailBankStatementPollUseCase } from './application/useCases/EmailBankStatementPollUseCase';
import { BroadcastOutboxDispatcher } from './infrastructure/queue/BroadcastOutboxDispatcher';
import { BroadcastQueue } from './infrastructure/queue/BroadcastQueue';
import { BroadcastWorker } from './infrastructure/queue/BroadcastWorker';
import { closeBroadcastRedisConnection } from './infrastructure/queue/redisConnection';
import { IBroadcastRepository } from './domain/repositories/IBroadcastRepository';
import { createWhatsappCloudWebhookRoutes } from './presentation/routes/whatsappCloudWebhookRoutes';
import { createWhatsappMessagesRoutes } from './presentation/routes/whatsappMessagesRoutes';
import { PostgresWhatsappCloudRepository } from './infrastructure/repositories/PostgresWhatsappCloudRepository';
import { WhatsappCloudClient } from './infrastructure/whatsappCloud/WhatsappCloudClient';
import { WhatsappCloudSender } from './infrastructure/whatsappCloud/WhatsappCloudSender';
import { WhatsappCloudInboxWorker } from './infrastructure/scheduler/WhatsappCloudInboxWorker';
import { resolveWhatsAppProvider, loadWhatsappCloudClientConfig } from './infrastructure/whatsappCloud/WhatsappCloudConfig';
import { IReminderMessageSender } from './domain/services/IReminderMessageSender';

const app = express();
const PORT = Number(process.env.PORT) || 3333;

// Confia no cabeçalho X-Forwarded-For do Railway/proxy para o rate limiter funcionar
app.set('trust proxy', true);

// ── Webhook da WhatsApp Cloud API ────────────────────────────────────────────
// Registrado ANTES de QUALQUER middleware global (helmet/cors/rate limit/json):
// 1) a validação de assinatura (X-Hub-Signature-256) exige os bytes brutos do corpo — o
//    express.json() global consumiria o stream antes que a rota pudesse acessá-lo;
// 2) o rate limit global é pensado para tráfego de usuário/frontend — aplicá-lo também à Meta
//    arrisca 429 durante um burst legítimo de eventos, o que pode fazer a Meta desistir de
//    reenviar e perder status de entrega definitivamente.
// Ver whatsappCloudWebhookRoutes.ts.
const whatsappCloudRepository = new PostgresWhatsappCloudRepository(container.resolve(Pool));
app.use('/api', createWhatsappCloudWebhookRoutes(whatsappCloudRepository));

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

// Histórico de conversa WhatsApp Cloud API por paciente — visualização + resposta manual, sem
// automação. cloudClient fica null (rota de envio desativada, fail-closed) se a config não
// estiver presente — a listagem continua funcionando normalmente de qualquer forma.
const whatsappMessagesCloudConfig = loadWhatsappCloudClientConfig();
const whatsappMessagesCloudClient = whatsappMessagesCloudConfig ? new WhatsappCloudClient(whatsappMessagesCloudConfig) : null;
app.use('/api', createWhatsappMessagesRoutes(
    whatsappCloudRepository,
    container.resolve<IPsychotherapyRepository>('IPsychotherapyRepository'),
    whatsappMessagesCloudClient
));

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

let broadcastDispatcher: BroadcastOutboxDispatcher | null = null;
let broadcastWorker: BroadcastWorker | null = null;

// Bootstrap process: Only connect to the DB and listen to the port when run directly
if (require.main === module) {
    const dbPool = container.resolve(Pool);
    // DISABLE_WHATSAPP_BOOT=true é o bypass de emergência documentado em .env.example
    // (mesma variável usada pelo scheduler-api para não competir pela sessão Baileys) —
    // precisa ter prioridade sobre ENABLE_WHATSAPP mesmo que este não esteja setado como 'false'.
    const isWhatsappEnabled =
        process.env.ENABLE_WHATSAPP !== 'false' &&
        process.env.DISABLE_WHATSAPP_BOOT !== 'true';
    
    logger.info('⏳ Testando conexão com o banco de dados...');
    dbPool.query('SELECT 1')
        .then(() => {
            logger.info('✅ Banco de dados conectado com sucesso.');
            app.listen(PORT, () => {
                logger.info(`🚀 Psychotherapy Backend rodando em http://localhost:${PORT}`);

                // Inicializar WhatsApp (opcional — só se ENABLE_WHATSAPP não for false)
                const sessionManager = container.resolve<WhatsappSessionManager>('WhatsappSessionManager');
                if (isWhatsappEnabled) {
                    const dbPool = container.resolve(Pool);
                    const receiptHandler = createPaymentReceiptHandler(dbPool);
                    sessionManager.initializeAll(dbPool, receiptHandler).catch(err => {
                        logger.error({ err }, '⚠️ Falha ao inicializar sessões WhatsApp (não crítico — app continua)');
                    });
                    logger.info('📱 WhatsApp Session Manager inicializado');
                } else {
                    const reason = process.env.DISABLE_WHATSAPP_BOOT === 'true'
                        ? 'DISABLE_WHATSAPP_BOOT=true'
                        : 'ENABLE_WHATSAPP=false';
                    logger.warn(`⚠️ WhatsApp desativado via ${reason}`);
                }

                // WhatsApp Cloud API (piloto single-tenant) — só instanciado quando as
                // credenciais estão presentes. Se WHATSAPP_PROVIDER=meta_cloud mas faltar
                // config, o sender fica undefined e o ReminderScheduler falha de forma visível
                // (fail-closed) em vez de cair silenciosamente para o Baileys.
                let whatsappCloudSender: IReminderMessageSender | undefined;
                const cloudClientConfig = loadWhatsappCloudClientConfig();
                if (cloudClientConfig) {
                    const cloudClient = new WhatsappCloudClient(cloudClientConfig);
                    whatsappCloudSender = new WhatsappCloudSender(cloudClient, whatsappCloudRepository);
                    logger.info('☁️ WhatsappCloudSender inicializado (WhatsApp Cloud API configurada).');
                } else if (resolveWhatsAppProvider() === 'meta_cloud') {
                    logger.error('❌ WHATSAPP_PROVIDER=meta_cloud, mas WHATSAPP_CLOUD_API_VERSION/PHONE_NUMBER_ID/TOKEN não estão todos configurados. Lembretes de WhatsApp vão falhar de forma visível até isso ser corrigido.');
                }

                // Worker durável da inbox do webhook — inicia sempre que houver alguma config de
                // Cloud API presente (mesmo que o provider ativo ainda seja 'baileys'), para não
                // perder eventos que a Meta já possa estar enviando durante a configuração inicial.
                if (cloudClientConfig) {
                    // Encaminhamento de mensagens recebidas para o número pessoal + histórico de
                    // conversa na ficha do paciente — opcional (requer WHATSAPP_NOTIFY_PHONE e
                    // WHATSAPP_CLOUD_TENANT_ID; ausência de qualquer um desativa ambos, sem
                    // afetar lembretes).
                    const notifyPhoneDigits = process.env.WHATSAPP_NOTIFY_PHONE?.replace(/\D/g, '');
                    const cloudTenantId = process.env.WHATSAPP_CLOUD_TENANT_ID?.trim();
                    const notifyConfig = (notifyPhoneDigits && cloudTenantId)
                        ? { client: new WhatsappCloudClient(cloudClientConfig), notifyPhoneDigits, tenantId: cloudTenantId }
                        : undefined;
                    if (!notifyConfig) {
                        logger.warn('⚠️ WHATSAPP_NOTIFY_PHONE/WHATSAPP_CLOUD_TENANT_ID não configurados — encaminhamento de respostas e histórico de conversa desativados.');
                    }
                    const inboxWorker = new WhatsappCloudInboxWorker(whatsappCloudRepository, notifyConfig);
                    inboxWorker.start();
                }

                if (process.env.ENABLE_REMINDERS !== 'false') {
                    const repository = container.resolve<IPsychotherapyRepository>('IPsychotherapyRepository');
                    const scheduler = new ReminderScheduler(
                        repository,
                        isWhatsappEnabled ? sessionManager : undefined,
                        whatsappCloudSender
                    );
                    scheduler.start();
                }

                if (process.env.ENABLE_GCAL_SYNC === 'true') {
                    const syncUseCase = container.resolve(SyncGoogleCalendarEventsUseCase);
                    const syncJob = new GoogleCalendarSyncJob(syncUseCase);
                    syncJob.start();
                }

                // Broadcast (mensagem em massa): desligado por padrão via feature flags.
                if (process.env.ENABLE_BROADCAST_MESSAGES === 'true') {
                    broadcastDispatcher = container.resolve(BroadcastOutboxDispatcher);
                    broadcastDispatcher.start();
                    logger.info('📣 Broadcast outbox dispatcher iniciado.');

                    if (process.env.BROADCAST_WORKER_ENABLED === 'true') {
                        if (!isWhatsappEnabled) {
                            logger.warn('⚠️ BROADCAST_WORKER_ENABLED=true mas WhatsApp não foi inicializado neste processo. Worker não será iniciado.');
                        } else {
                            const broadcastRepository = container.resolve<IBroadcastRepository>('IBroadcastRepository');
                            broadcastWorker = new BroadcastWorker(broadcastRepository, sessionManager);
                            broadcastWorker.start();
                            logger.info('📣 Broadcast worker iniciado.');
                        }
                    }
                }

                // Cron 1: Limpeza diária de failed_totp_attempts
                nodeCron.schedule('0 3 * * *', async () => {
                    logger.info('🧹 Executando limpeza diária de failed_totp_attempts...');
                    const pool = container.resolve(Pool);
                    try {
                        await pool.query("DELETE FROM failed_totp_attempts WHERE attempted_at < NOW() - INTERVAL '24 hours';");
                        logger.info('✅ Limpeza de failed_totp_attempts concluída.');
                    } catch (err) {
                        logger.error({ err }, 'Erro ao limpar failed_totp_attempts.');
                    }
                });

                // Cron 2: Conciliação ativa Pix a cada 15 minutos
                nodeCron.schedule('*/15 * * * *', async () => {
                    try {
                        await reconcilePixCharges();
                    } catch (err) {
                        logger.error({ err }, 'Erro ao rodar conciliação ativa Pix em background');
                    }
                });

                // Cron 3: Ingestão automática de extrato bancário via e-mail (Gmail),
                // toda segunda-feira às 6h (horário de Brasília) — o Nubank envia o
                // extrato semanalmente, não precisa de polling mais frequente.
                nodeCron.schedule('0 6 * * 1', async () => {
                    try {
                        await container.resolve(EmailBankStatementPollUseCase).execute();
                    } catch (err) {
                        logger.error({ err }, 'Erro ao rodar polling de extrato bancário via e-mail');
                    }
                }, { timezone: 'America/Sao_Paulo' });
            });
        })
        .catch(err => {
            logger.error({ err }, '❌ Falha ao conectar ao banco de dados durante a inicialização.');
            process.exit(1);
        });

    const gracefulShutdown = async (signal: string) => {
        logger.info(`🛑 Recebido ${signal}. Encerrando processos de broadcast...`);
        try {
            await broadcastWorker?.stop();
            broadcastDispatcher?.stop();
            await container.resolve(BroadcastQueue).close();
            await closeBroadcastRedisConnection();
        } catch (err) {
            logger.error({ err }, 'Erro durante o encerramento gracioso do broadcast.');
        } finally {
            process.exit(0);
        }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

export default app;
