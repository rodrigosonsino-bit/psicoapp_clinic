import { Pool } from 'pg';
import { EventEmitter } from 'events';
import { WhatsappClient, IncomingMessageHandler, MessageStatusHandler } from './WhatsappClient';
import { logger } from '../logger';
import { acquireTenantSocketLock, TenantSocketLock } from './TenantSocketLock';
import { usePostgresAuthState } from '../database/PostgresAuthState';

export class WhatsappSessionManager extends EventEmitter {
    private sessions: Map<string, WhatsappClient> = new Map();
    private locks: Map<string, TenantSocketLock> = new Map();
    private dbPool: Pool | null = null;
    private messageHandler?: IncomingMessageHandler;
    private statusHandler?: MessageStatusHandler;
    private readonly appName: string;

    constructor(appName: string = 'default') {
        super();
        this.appName = appName;
    }

    async initializeAll(dbPool: Pool, messageHandler?: IncomingMessageHandler, statusHandler?: MessageStatusHandler): Promise<void> {
        this.dbPool = dbPool;
        this.messageHandler = messageHandler;
        this.statusHandler = statusHandler;

        if (process.env.DISABLE_WHATSAPP_BOOT === 'true') {
            logger.info('⚠️ WhatsApp auto-boot desativado. Inicializando apenas o gerenciador de sessões.');
            return;
        }

        try {
            logger.info('🚀 Inicializando sessões ativas do WhatsApp...');
            const result = await dbPool.query(
                `SELECT id FROM tenants
                 WHERE whatsapp_connected = TRUE
                   AND status IN ('active', 'trial')`
            );

            for (const row of result.rows) {
                const tenantId = row.id;
                logger.info(`Auto-conectando WhatsApp para tenant: ${tenantId}`);
                const { state, saveCreds } = await usePostgresAuthState(this.dbPool!, tenantId, this.appName);
                const client = await this.createSession(tenantId);
                if (!client) {
                    logger.warn({ tenantId }, '⏭️ Sessão não iniciada nesta instância (outra instância já detém o socket deste tenant).');
                }

                // Aguarda 3 segundos entre a inicialização de cada tenant para evitar
                // "thundering herd" e event loop starvation que causam os erros 1006
                // por estrangulamento do websocket no boot da API.
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
            logger.info(`Sessões ativas inicializadas: ${this.sessions.size}`);
        } catch (err) {
            logger.error({ err }, 'Erro ao inicializar sessões de WhatsApp no bootstrap');
        }
    }

    async getSession(tenantId: string): Promise<WhatsappClient | null> {
        const existing = this.sessions.get(tenantId);
        if (existing) return existing;

        if (!this.dbPool) return null;

        try {
            logger.warn({ tenantId }, '⚠️ Sessão não encontrada na memória. Tentando lazy init...');
            const result = await this.dbPool.query(
                `SELECT id FROM tenants WHERE id = $1::uuid AND whatsapp_connected = TRUE AND status IN ('active', 'trial')`,
                [tenantId]
            );
            if (result.rows.length === 0) {
                logger.warn({ tenantId }, 'Tenant não elegível para lazy init (desconectado ou inativo).');
                return null;
            }
            const client = await this.createSession(tenantId);
            if (client) {
                logger.info({ tenantId }, '✅ Lazy init de sessão WhatsApp realizado com sucesso.');
            } else {
                logger.warn({ tenantId }, '⏭️ Lazy init não realizado: outra instância já detém o socket deste tenant.');
            }
            return client;
        } catch (err) {
            logger.error({ err, tenantId }, 'Falha no lazy init da sessão WhatsApp.');
            return null;
        }
    }

    /**
     * Cria a sessão WhatsApp do tenant, mas só se conseguir adquirir o lock distribuído
     * (advisory lock do Postgres) que garante que nenhuma outra instância do servidor
     * (ex: container antigo de um rolling deploy ainda em desligamento) esteja com o
     * socket desse tenant aberto ao mesmo tempo. Retorna null se o lock já está em uso.
     */
    async createSession(tenantId: string): Promise<WhatsappClient | null> {
        if (!this.dbPool) {
            throw new Error('WhatsappSessionManager não inicializado.');
        }

        const existing = this.sessions.get(tenantId);
        if (existing) {
            return existing;
        }

        const lock = await acquireTenantSocketLock(this.dbPool, tenantId);
        if (!lock) {
            return null;
        }

        try {
            logger.info({ tenantId }, 'Criando nova sessão WhatsApp para tenant');
            const client = new WhatsappClient(tenantId, this.appName, { onIncomingMessage: this.messageHandler, onMessageStatusUpdate: this.statusHandler });

            await client.initialize(this.dbPool);
            this.sessions.set(tenantId, client);
            this.locks.set(tenantId, lock);
            return client;
        } catch (err) {
            await lock.release();
            throw err;
        }
    }

    private async releaseLock(tenantId: string): Promise<void> {
        const lock = this.locks.get(tenantId);
        if (lock) {
            this.locks.delete(tenantId);
            try {
                await lock.release();
            } catch (err) {
                logger.error({ err, tenantId }, 'Erro ao liberar lock de sessão WhatsApp do tenant.');
            }
        }
    }

    async destroySession(tenantId: string): Promise<void> {
        const client = this.sessions.get(tenantId);
        if (client) {
            try {
                await client.logout();
            } catch (err) {
                logger.error({ err, tenantId }, 'Erro ao deslogar sessão durante destruição');
            }
            this.sessions.delete(tenantId);
            await this.releaseLock(tenantId);
            logger.info({ tenantId }, 'Sessão do WhatsApp destruída com sucesso.');
        }
    }

    /**
     * Remove a sessão da memória sem tentar fazer logout no WebSocket.
     * Usar quando o socket está morto/corrompido e logout falharia.
     * A limpeza do banco deve ser feita pelo chamador.
     */
    async forceRemoveSession(tenantId: string): Promise<void> {
        const client = this.sessions.get(tenantId);
        if (client) {
            try { await client.close(); } catch { }
        }
        this.sessions.delete(tenantId);
        await this.releaseLock(tenantId);
        logger.info({ tenantId }, 'Sessão WhatsApp removida da memória (force remove).');
    }

    async closeAll(): Promise<void> {
        logger.info('Fechando todos os sockets do WhatsApp (graceful shutdown)...');
        for (const [tenantId, client] of this.sessions.entries()) {
            try {
                await client.close();
            } catch (err) {
                logger.error({ err, tenantId }, 'Erro ao fechar sessão durante encerramento global');
            }
            await this.releaseLock(tenantId);
        }
        this.sessions.clear();
        logger.info('Todos os sockets do WhatsApp foram fechados.');
    }

    getActiveSessions(): Map<string, WhatsappClient> {
        return this.sessions;
    }
}
