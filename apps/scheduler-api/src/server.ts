import { Pool } from 'pg';
import IORedis from 'ioredis';
const RedisMock = require('ioredis-mock');
import * as fs from 'fs';
import * as path from 'path';
import { createApp } from './app';
import { MessageWorker } from './infrastructure/queue/MessageWorker';
import { PostgresUsageTracker } from './infrastructure/billing/PostgresUsageTracker';
import { PostgresMessageRepository } from './infrastructure/repositories/PostgresMessageRepository';
import { WhatsappSessionManager } from './infrastructure/whatsapp/WhatsappSessionManager';
import { GeminiClient } from './infrastructure/gemini/GeminiClient';
import { TelegramClient } from './infrastructure/telegram/TelegramClient';
import { logger } from './infrastructure/logger/logger';
import { BullMQMessageScheduler } from './infrastructure/queue/BullMQMessageScheduler';
import { ReconciliationJob } from './infrastructure/cron/ReconciliationJob';
import { GoogleCalendarClient } from './infrastructure/google/GoogleCalendarClient';
import { SyncGoogleCalendarUseCase } from './application/useCases/SyncGoogleCalendarUseCase';
import { GoogleCalendarSyncJob } from './infrastructure/cron/GoogleCalendarSyncJob';
import { WeeklyReportUseCase } from './application/useCases/WeeklyReportUseCase';
import { WeeklyReportCronJob } from './infrastructure/cron/WeeklyReportCronJob';
import { FixedExpensesCronJob } from './infrastructure/cron/FixedExpensesCronJob';

import * as dotenv from 'dotenv';

// 1. Carregar variáveis do arquivo .env
dotenv.config();
logger.info('📌 Variáveis do arquivo .env carregadas com sucesso via dotenv!');

// 2. Conexões Essenciais
const dbPool = process.env.DATABASE_URL
    ? new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('railway.app') || process.env.DATABASE_URL.includes('supabase.com') || process.env.DATABASE_URL.includes('neon.tech') ? { rejectUnauthorized: false } : undefined,
        max: parseInt(process.env.DB_POOL_MAX || '20', 10),
        idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000', 10),
        connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONN_TIMEOUT || '2000', 10)
      })
    : new Pool({
        user: process.env.DB_USER || 'postgres',
        host: process.env.DB_HOST || 'localhost',
        database: process.env.DB_NAME || 'whatsapp_scheduler',
        password: process.env.DB_PASSWORD,
        port: parseInt(process.env.DB_PORT || '5432', 10),
        max: parseInt(process.env.DB_POOL_MAX || '20', 10),
        idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000', 10),
        connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONN_TIMEOUT || '2000', 10)
      });

// Tratar erros inesperados no pool do PostgreSQL para evitar crash do Node.js
// Neon e provedores Serverless costumam derrubar conexões inativas ou fechar conexões
// abruptamente, o que gera um evento 'error' no pool que, se não tratado, derruba a API.
dbPool.on('error', (err, client) => {
    logger.error({ err }, '⚠️ Erro inesperado no pool do PostgreSQL (conexão perdida/timeout). O pool tentará reconectar automaticamente.');
});

let redisConnection: any;

if (process.env.REDIS_URL === 'mock') {
    redisConnection = new RedisMock();
} else {
    redisConnection = process.env.REDIS_URL
        ? new IORedis(process.env.REDIS_URL, {
            maxRetriesPerRequest: null,
            tls: process.env.REDIS_TLS === 'true' ? { rejectUnauthorized: false } : undefined
        })
        : new IORedis({
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379', 10),
            password: process.env.REDIS_PASSWORD || undefined,
            maxRetriesPerRequest: null,
            tls: process.env.REDIS_TLS === 'true' ? { rejectUnauthorized: false } : undefined
        });
}

// Removed TBD ensureDatabaseSchema
async function connectWithRetry(pool: Pool, retries = 5, delay = 2000): Promise<void> {
    for (let i = 1; i <= retries; i++) {
        try {
            await pool.query('SELECT 1');
            return;
        } catch (err) {
            logger.warn(`⚠️  Falha ao conectar ao banco de dados (Tentativa ${i}/${retries}). Erro: ${err instanceof Error ? err.message : String(err)}`);
            if (i === retries) throw err;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

async function bootstrap() {
    try {
        // Testar a conexão com o banco
        await dbPool.query('SELECT NOW()');
        logger.info('✅ Conexão com o banco de dados estabelecida.');
        
        // Garantir que a conexão com o banco esteja estabelecida antes de prosseguir
        logger.info('🔌 Conectando ao banco de dados...');
        await connectWithRetry(dbPool);

        // 3. Conectar Canais de Comunicação (WhatsApp e Telegram) e IA
        const sessionManager = new WhatsappSessionManager();
        const geminiClient = new GeminiClient(dbPool, sessionManager);

        // Handler de mensagens recebidas: delega para a IA (Sarah)
        const messageHandler = async (ctx: { tenantId: string; from: string; name: string; text: string; isAudio: boolean; isImage: boolean; isDocument: boolean; mediaData?: { mimeType: string; data: string } }) => {
            const settings = await geminiClient.getAISettings(ctx.tenantId);
            if (!settings.enabled) return null;
            return geminiClient.generateAutoReply(ctx.from, ctx.name, ctx.text, settings.instructions, ctx.mediaData, ctx.tenantId);
        };

        if (process.env.DISABLE_WHATSAPP_BOOT !== 'true') {
            await sessionManager.initializeAll(dbPool, messageHandler);
        } else {
            logger.warn('⚠️  Inicialização do WhatsApp pulada via DISABLE_WHATSAPP_BOOT=true');
        }

        const telegramClient = new TelegramClient(process.env.TELEGRAM_BOT_TOKEN || '');
        telegramClient.initialize().catch(err => {
            logger.fatal({ err }, 'Falha fatal ao montar núcleo do Telegram');
        });

        // 4. Montar a Aplicação Express
        const app = createApp(dbPool, redisConnection, sessionManager, telegramClient, geminiClient);
        const PORT = process.env.PORT || 3000;

        // 5. Iniciar Worker de Fila (BullMQ)
        const messageRepository = new PostgresMessageRepository(dbPool);
        const messageScheduler = new BullMQMessageScheduler(redisConnection);
        const usageTracker = new PostgresUsageTracker(dbPool);
        const messageWorker = new MessageWorker(redisConnection, messageRepository, sessionManager, { telegram: telegramClient }, messageScheduler, 'whatsapp-messages', usageTracker);

        // 6. Iniciar Serviço de Reconciliação (Recuperação contra quedas do Redis)
        const reconciliationJob = new ReconciliationJob(messageRepository, messageScheduler, sessionManager);
        reconciliationJob.start();

        // 7. Iniciar Serviço de Sincronização Google Calendar (Cron Job)
        const googleCalendarClient = new GoogleCalendarClient(dbPool);
        const syncGoogleCalendarUseCase = new SyncGoogleCalendarUseCase(googleCalendarClient, messageRepository, dbPool, messageScheduler);
        const googleCalendarSyncJob = new GoogleCalendarSyncJob(syncGoogleCalendarUseCase);
        googleCalendarSyncJob.start();

        // 8. Iniciar Serviço de Relatório Semanal Automático (Cron Job)
        const weeklyReportUseCase = new WeeklyReportUseCase(messageRepository);
        const weeklyReportCronJob = new WeeklyReportCronJob(weeklyReportUseCase, sessionManager, dbPool);
        weeklyReportCronJob.start();

        // 8.5. Iniciar Serviço de Geração de Despesas Fixas (Cron Job)
        const fixedExpensesCronJob = new FixedExpensesCronJob(dbPool);
        fixedExpensesCronJob.start();

        // 9. Cron de manutenção da Sarah: Limpeza de bloqueios expirados + Watchdog de conexão zombie para todos os tenants ativos
        const cron = require('node-cron');
        cron.schedule('*/2 * * * *', async () => {
            for (const [tenantId, client] of sessionManager.getActiveSessions().entries()) {
                try {
                    // Limpar cooldowns de AI expirados
                    await client.cleanupExpiredAiBlocks();
                    // Detectar e reconectar se socket estiver em estado zumbi (probe ativo)
                    await client.checkZombieConnection();
                } catch (err) {
                    logger.error({ err, tenantId }, 'Erro na manutenção da Sarah para tenant');
                }
            }
        }, { timezone: 'America/Sao_Paulo' });
        logger.info('🛡️ Cron de Manutenção da Sarah ATIVADO (Watchdog com probe ativo + Cleanup a cada 2 min para todos os tenants ativos).');

        // 9. OUVIR
        app.listen(PORT, () => {
            logger.info(`🚀 API Online na porta ${PORT} | Health Check em /api/health`);
        });

        // Graceful Shutdown
        const shutdown = async (signal: string) => {
            logger.info(`Sinal ${signal} recebido. Encerrando serviços (Graceful Shutdown) ...`);
            await messageWorker.close();
            await sessionManager.closeAll();
            await telegramClient.stop();
            await redisConnection.quit();
            await dbPool.end();
            logger.info('Desligamento concluído limpidamente.');
            process.exit(0);
        };
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));

    } catch (err) {
        logger.fatal({ err }, 'Falha fatal durante a inicialização (bootstrap) do servidor');
        process.exit(1);
    }
}

bootstrap();

process.on('unhandledRejection', (reason, promise) => { console.error('Unhandled Rejection at:', promise, 'reason:', reason); });
