import { Pool } from 'pg';
import IORedis from 'ioredis';
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
        ssl: process.env.DATABASE_URL.includes('railway.app') || process.env.DATABASE_URL.includes('supabase.com') ? { rejectUnauthorized: false } : undefined,
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

const redisConnection = process.env.REDIS_URL
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

// 2.5. Rotina de Verificação e Atualização Automática de Tabelas (Self-Healing)
async function ensureDatabaseSchema(pool: Pool) {
    try {
        logger.info('🔍 Verificando e atualizando a estrutura do banco de dados (schema)...');
        const shouldSeedDevelopmentTenant = process.env.NODE_ENV !== 'production';

        await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');

        // Tabela de tenants
        await pool.query(`
            CREATE TABLE IF NOT EXISTS tenants (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                plan VARCHAR(50) DEFAULT 'starter',
                status VARCHAR(20) DEFAULT 'trial',
                stripe_customer_id VARCHAR(255),
                stripe_subscription_id VARCHAR(255),
                mp_subscription_id VARCHAR(255),
                subscription_status VARCHAR(50) DEFAULT 'trialing',
                current_period_end TIMESTAMPTZ,
                max_messages_per_month INT DEFAULT 200,
                whatsapp_connected BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;

            CREATE TABLE IF NOT EXISTS plans (
                id VARCHAR(50) PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                stripe_price_id VARCHAR(255),
                mp_plan_id VARCHAR(255),
                price_cents INT NOT NULL,
                max_messages_per_month INT NOT NULL,
                features JSONB DEFAULT '{}',
                active BOOLEAN DEFAULT TRUE
            );
            ALTER TABLE plans ADD COLUMN IF NOT EXISTS mp_plan_id VARCHAR(255);

            CREATE TABLE IF NOT EXISTS usage_tracking (
                tenant_id UUID NOT NULL REFERENCES tenants(id),
                month VARCHAR(7) NOT NULL,
                messages_sent INT DEFAULT 0,
                messages_failed INT DEFAULT 0,
                PRIMARY KEY (tenant_id, month)
            );

            -- Seed de planos padrão (removido para ser executado de forma parametrizada com IDs do Stripe)
        `);

        // Garantir que o admin de produção tenha is_admin = true (idempotente)
        const prodAdminEmail = process.env.ADMIN_EMAIL;
        if (prodAdminEmail) {
            const cleanEmail = prodAdminEmail.trim();
            const updateRes = await pool.query(
                `UPDATE tenants SET is_admin = TRUE WHERE LOWER(email) = LOWER($1) RETURNING id, email, is_admin`,
                [cleanEmail]
            );
            logger.info({
                configuredEmail: prodAdminEmail,
                cleanEmail,
                updatedRowCount: updateRes.rowCount,
                updatedRows: updateRes.rows
            }, '✅ is_admin garantido para o admin de produção');

            // Logar todos os tenants para podermos ver quem está cadastrado no banco de dados e qual o email exato.
            try {
                const listRes = await pool.query('SELECT id, name, email, is_admin FROM tenants');
                logger.info({ tenantsCount: listRes.rowCount, tenants: listRes.rows }, '🔍 Lista de tenants cadastrados no banco');
            } catch (listErr) {
                logger.error({ err: listErr }, '❌ Erro ao listar tenants para diagnóstico');
            }
        } else {
            logger.warn('⚠️  ADMIN_EMAIL não definido no ambiente.');
        }

        if (shouldSeedDevelopmentTenant) {
            const devHash = process.env.DEV_ADMIN_PASSWORD_HASH;
            if (!devHash) {
                logger.warn('⚠️  DEV_ADMIN_PASSWORD_HASH não definido. Seed do tenant de desenvolvimento ignorado.');
            } else {
                await pool.query(`
                    -- Migrar tenant inicial apenas fora de produção
                    INSERT INTO tenants (id, name, email, password_hash, plan, status, max_messages_per_month, is_admin)
                    VALUES (
                        gen_random_uuid(),
                        'Rodrigo',
                        'rodrigo@example.com',
                        $1,
                        'business',
                        'active',
                        5000,
                        true
                    ) ON CONFLICT (email) DO UPDATE SET is_admin = true;
                `, [devHash]);
            }
        }

        // Criar tabela de agendamentos e adicionar a coluna metadata caso não exista
        await pool.query(`
            CREATE TABLE IF NOT EXISTS scheduled_messages (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id VARCHAR(255) NOT NULL,
                content TEXT NOT NULL,
                recipient_id VARCHAR(255) NOT NULL,
                send_at TIMESTAMP WITH TIME ZONE NOT NULL,
                status VARCHAR(50) NOT NULL DEFAULT 'pending',
                platform VARCHAR(20) DEFAULT 'whatsapp',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_scheduled_messages_user_id ON scheduled_messages(user_id);
            
            ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT NULL;
        `);

        if (shouldSeedDevelopmentTenant) {
            await pool.query(`
                -- Atualizar user_id antigo para o tenant de desenvolvimento recem criado
                WITH target AS (SELECT id::text AS tid FROM tenants WHERE email = 'rodrigo@example.com' LIMIT 1)
                UPDATE scheduled_messages SET user_id = (SELECT tid FROM target) WHERE user_id = 'default-user-id';
            `);
        }

        // Tabela whatsapp_auth - simplificada e compatível com PostgresAuthState
        await pool.query(`
            CREATE TABLE IF NOT EXISTS whatsapp_auth (
                key VARCHAR(255) PRIMARY KEY,
                value JSONB NOT NULL
            );
        `);

        // Migração auto-recuperativa caso o banco de dados já possua o schema antigo
        try {
            await pool.query(`
                DO $$
                BEGIN
                    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name='whatsapp_auth' AND column_name='user_id') THEN
                        ALTER TABLE whatsapp_auth DROP CONSTRAINT IF EXISTS whatsapp_auth_pkey;
                        ALTER TABLE whatsapp_auth DROP COLUMN IF EXISTS user_id;
                        IF NOT EXISTS (
                            SELECT 1 FROM information_schema.table_constraints 
                            WHERE table_name='whatsapp_auth' AND constraint_type='PRIMARY KEY'
                        ) THEN
                            ALTER TABLE whatsapp_auth ADD CONSTRAINT whatsapp_auth_pkey PRIMARY KEY (key);
                        END IF;
                    END IF;
                END $$;
            `);
        } catch (migrationErr) {
            logger.warn({ err: migrationErr }, 'Aviso na migração automática da tabela whatsapp_auth (pode já estar atualizada)');
        }

        // Tabela whatsapp_contacts
        await pool.query(`
            CREATE TABLE IF NOT EXISTS whatsapp_contacts (
                id VARCHAR(255) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                ai_disabled BOOLEAN DEFAULT FALSE,
                ai_disabled_at TIMESTAMP WITH TIME ZONE
            );

            -- Nome vindo da agenda do Google (People API); tem prioridade na exibição
            ALTER TABLE whatsapp_contacts ADD COLUMN IF NOT EXISTS google_name VARCHAR(255);
        `);

        // Tabela system_settings
        await pool.query(`
            CREATE TABLE IF NOT EXISTS system_settings (
                user_id VARCHAR(255) PRIMARY KEY,
                ai_auto_reply_enabled BOOLEAN DEFAULT FALSE,
                ai_auto_reply_instructions TEXT,
                office_hours JSONB,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        await pool.query(`
            ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS receive_weekly_report BOOLEAN DEFAULT FALSE;
            ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS weekly_report_day VARCHAR(10) DEFAULT '1';
            ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS weekly_report_time VARCHAR(10) DEFAULT '08:00';
        `);

        if (shouldSeedDevelopmentTenant) {
            await pool.query(`
                WITH target AS (SELECT id::text AS tid FROM tenants WHERE email = 'rodrigo@example.com' LIMIT 1)
                UPDATE system_settings SET user_id = (SELECT tid FROM target) WHERE user_id = 'default-user-id';
            `);
        }

        // Tabela google_calendar_configs
        await pool.query(`
            CREATE TABLE IF NOT EXISTS google_calendar_configs (
                user_id VARCHAR(255) PRIMARY KEY,
                access_token TEXT NOT NULL,
                refresh_token TEXT NOT NULL,
                expiry_date BIGINT NOT NULL,
                email VARCHAR(255) NOT NULL,
                is_enabled BOOLEAN DEFAULT TRUE,
                calendar_id VARCHAR(255),
                calendar_name VARCHAR(255),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        if (shouldSeedDevelopmentTenant) {
            await pool.query(`
                WITH target AS (SELECT id::text AS tid FROM tenants WHERE email = 'rodrigo@example.com' LIMIT 1)
                UPDATE google_calendar_configs SET user_id = (SELECT tid FROM target) WHERE user_id = 'default-user-id';
            `);
        }

        // Tabela google_event_preferences
        await pool.query(`
            CREATE TABLE IF NOT EXISTS google_event_preferences (
                user_id VARCHAR(255) NOT NULL,
                event_id VARCHAR(255) NOT NULL,
                auto_send BOOLEAN DEFAULT TRUE,
                event_summary VARCHAR(255),
                event_start TIMESTAMP WITH TIME ZONE,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, event_id)
            );
        `);

        if (shouldSeedDevelopmentTenant) {
            await pool.query(`
                WITH target AS (SELECT id::text AS tid FROM tenants WHERE email = 'rodrigo@example.com' LIMIT 1)
                UPDATE google_event_preferences SET user_id = (SELECT tid FROM target) WHERE user_id = 'default-user-id';
            `);
        }

        // Tabela whatsapp_ai_chats
        await pool.query(`
            CREATE TABLE IF NOT EXISTS whatsapp_ai_chats (
                id SERIAL PRIMARY KEY,
                contact_jid VARCHAR(255) NOT NULL,
                role VARCHAR(50) NOT NULL,
                message_text TEXT NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_whatsapp_ai_chats_jid ON whatsapp_ai_chats(contact_jid);
        `);

        // Tabela whatsapp_ai_contact_contexts para memória persistente por contato
        await pool.query(`
            CREATE TABLE IF NOT EXISTS whatsapp_ai_contact_contexts (
                contact_jid VARCHAR(255) PRIMARY KEY,
                display_name VARCHAR(255),
                summary TEXT,
                current_intent VARCHAR(100),
                conversation_stage VARCHAR(100),
                pending_action JSONB,
                preferences JSONB,
                last_interaction_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        // FASE 3: Isolamento Completo de Dados (Multi-Tenant PKs)
        await pool.query(`
            -- 1. whatsapp_auth
            ALTER TABLE whatsapp_auth ADD COLUMN IF NOT EXISTS tenant_id UUID;
            
            DO $$ BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.key_column_usage
                    WHERE table_name = 'whatsapp_auth' AND column_name = 'tenant_id'
                ) THEN
                    UPDATE whatsapp_auth SET tenant_id = (SELECT id FROM tenants LIMIT 1) WHERE tenant_id IS NULL;
                    ALTER TABLE whatsapp_auth ALTER COLUMN tenant_id SET NOT NULL;
                    ALTER TABLE whatsapp_auth DROP CONSTRAINT IF EXISTS whatsapp_auth_pkey;
                    ALTER TABLE whatsapp_auth ADD PRIMARY KEY (tenant_id, key);
                END IF;
            END $$;

            -- 2. whatsapp_contacts
            ALTER TABLE whatsapp_contacts ADD COLUMN IF NOT EXISTS tenant_id UUID;
            
            DO $$ BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.key_column_usage
                    WHERE table_name = 'whatsapp_contacts' AND column_name = 'tenant_id'
                ) THEN
                    UPDATE whatsapp_contacts SET tenant_id = (SELECT id FROM tenants LIMIT 1) WHERE tenant_id IS NULL;
                    ALTER TABLE whatsapp_contacts ALTER COLUMN tenant_id SET NOT NULL;
                    ALTER TABLE whatsapp_contacts DROP CONSTRAINT IF EXISTS whatsapp_contacts_pkey;
                    ALTER TABLE whatsapp_contacts ADD PRIMARY KEY (tenant_id, id);
                END IF;
            END $$;

            -- 3. whatsapp_ai_contact_contexts
            ALTER TABLE whatsapp_ai_contact_contexts ADD COLUMN IF NOT EXISTS tenant_id UUID;
            
            DO $$ BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.key_column_usage
                    WHERE table_name = 'whatsapp_ai_contact_contexts' AND column_name = 'tenant_id'
                ) THEN
                    UPDATE whatsapp_ai_contact_contexts SET tenant_id = (SELECT id FROM tenants LIMIT 1) WHERE tenant_id IS NULL;
                    ALTER TABLE whatsapp_ai_contact_contexts ALTER COLUMN tenant_id SET NOT NULL;
                    ALTER TABLE whatsapp_ai_contact_contexts DROP CONSTRAINT IF EXISTS whatsapp_ai_contact_contexts_pkey;
                    ALTER TABLE whatsapp_ai_contact_contexts ADD PRIMARY KEY (tenant_id, contact_jid);
                END IF;
            END $$;

            -- 4. whatsapp_ai_chats
            ALTER TABLE whatsapp_ai_chats ADD COLUMN IF NOT EXISTS tenant_id UUID;
            UPDATE whatsapp_ai_chats SET tenant_id = (SELECT id FROM tenants LIMIT 1) WHERE tenant_id IS NULL;
            CREATE INDEX IF NOT EXISTS idx_ai_chats_tenant ON whatsapp_ai_chats(tenant_id, contact_jid);

            -- FASE 4: Cobrança Recorrente - Tabelas para idempotência de webhook
            CREATE TABLE IF NOT EXISTS stripe_events (
                event_id VARCHAR(255) PRIMARY KEY,
                type VARCHAR(100) NOT NULL,
                processed_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS mp_events (
                event_id VARCHAR(255) PRIMARY KEY,
                type VARCHAR(100) NOT NULL,
                processed_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        // Seed: único plano pago (Business); Trial é apenas um status, não um plano
        await pool.query(`
            INSERT INTO plans (id, name, mp_plan_id, price_cents, max_messages_per_month, features)
            VALUES ('business', 'Business', NULLIF($1, ''), 19900, 5000, '{"whatsapp": true, "ai": true, "calendar": true, "reports": true}')
            ON CONFLICT (id) DO UPDATE SET
                mp_plan_id = COALESCE(EXCLUDED.mp_plan_id, plans.mp_plan_id),
                price_cents = EXCLUDED.price_cents,
                max_messages_per_month = EXCLUDED.max_messages_per_month,
                features = EXCLUDED.features;
        `, [process.env.MP_BUSINESS_PLAN_ID || '']);

        logger.info('✅ Estrutura do banco de dados verificada/atualizada com sucesso!');
    } catch (err: any) {
        logger.error({ err }, '❌ Erro crítico ao verificar ou atualizar o schema do banco de dados');
        throw err;
    }
}

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
        // Testar a conexão com o banco e rodar migrações do Mercado Pago
        await dbPool.query('SELECT NOW()');
        logger.info('✅ Conexão com o banco de dados estabelecida.');
        
        await dbPool.query(`
            CREATE TABLE IF NOT EXISTS mp_events (
                event_id VARCHAR PRIMARY KEY,
                type VARCHAR,
                processed_at TIMESTAMP DEFAULT NOW()
            );
        `);
        await dbPool.query(`
            ALTER TABLE tenants ADD COLUMN IF NOT EXISTS mp_subscription_id VARCHAR;
        `);
        logger.info('✅ Migrações do Mercado Pago concluídas.');
        
        // Garantir que a conexão com o banco esteja estabelecida antes de prosseguir
        logger.info('🔌 Conectando ao banco de dados...');
        await connectWithRetry(dbPool);

        // Garantir o schema antes de iniciar qualquer serviço
        await ensureDatabaseSchema(dbPool);

        // 3. Conectar Canais de Comunicação (WhatsApp e Telegram) e IA
        const sessionManager = new WhatsappSessionManager();
        const geminiClient = new GeminiClient(dbPool, sessionManager);

        // Handler de mensagens recebidas: delega para a IA (Sarah)
        const messageHandler = async (ctx: { tenantId: string; from: string; name: string; text: string; isAudio: boolean; isImage: boolean; isDocument: boolean; mediaData?: { mimeType: string; data: string } }) => {
            const settings = await geminiClient.getAISettings(ctx.tenantId);
            if (!settings.enabled) return null;
            return geminiClient.generateAutoReply(ctx.from, ctx.name, ctx.text, settings.instructions, ctx.mediaData, ctx.tenantId);
        };

        await sessionManager.initializeAll(dbPool, messageHandler);

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
        cron.schedule('*/5 * * * *', async () => {
            for (const [tenantId, client] of sessionManager.getActiveSessions().entries()) {
                try {
                    // Limpar cooldowns de AI expirados
                    await client.cleanupExpiredAiBlocks();
                    // Detectar e reconectar se socket estiver em estado zumbi
                    client.checkZombieConnection();
                } catch (err) {
                    logger.error({ err, tenantId }, 'Erro na manutenção da Sarah para tenant');
                }
            }
        }, { timezone: 'America/Sao_Paulo' });
        logger.info('🛡️ Cron de Manutenção da Sarah ATIVADO (Watchdog + Cleanup a cada 5 min para todos os tenants ativos).');

        // 9. OUVIR
        app.listen(PORT, () => {
            logger.info(`🚀 API Online na porta ${PORT} | Health Check em /api/health`);
        });

        // Graceful Shutdown
        process.on('SIGINT', async () => {
            logger.info('Sinal de desligamento recebido. Encerrando serviços (Graceful Shutdown) ...');
            await messageWorker.close();
            await sessionManager.closeAll();
            await telegramClient.stop();
            await redisConnection.quit();
            await dbPool.end();
            logger.info('Desligamento concluído limpidamente.');
            process.exit(0);
        });

    } catch (err) {
        logger.fatal({ err }, 'Falha fatal durante a inicialização (bootstrap) do servidor');
        process.exit(1);
    }
}

bootstrap();
