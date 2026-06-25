import { Pool } from 'pg';
import { WhatsappClient, IncomingMessageHandler } from './WhatsappClient';
import { logger } from '../logger';

export class WhatsappSessionManager {
    private sessions: Map<string, WhatsappClient> = new Map();
    private dbPool: Pool | null = null;
    private messageHandler?: IncomingMessageHandler;

    constructor() {}

    async initializeAll(dbPool: Pool, messageHandler?: IncomingMessageHandler): Promise<void> {
        this.dbPool = dbPool;
        this.messageHandler = messageHandler;

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
                await this.createSession(tenantId);
                
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
            logger.info({ tenantId }, '✅ Lazy init de sessão WhatsApp realizado com sucesso.');
            return client;
        } catch (err) {
            logger.error({ err, tenantId }, 'Falha no lazy init da sessão WhatsApp.');
            return null;
        }
    }

    async createSession(tenantId: string): Promise<WhatsappClient> {
        if (!this.dbPool) {
            throw new Error('WhatsappSessionManager não inicializado.');
        }

        const existing = this.sessions.get(tenantId);
        if (existing) {
            return existing;
        }

        logger.info({ tenantId }, 'Criando nova sessão WhatsApp para tenant');
        const client = new WhatsappClient(tenantId, { onIncomingMessage: this.messageHandler });

        await client.initialize(this.dbPool);
        this.sessions.set(tenantId, client);
        return client;
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
        }
        this.sessions.clear();
        logger.info('Todos os sockets do WhatsApp foram fechados.');
    }

    getActiveSessions(): Map<string, WhatsappClient> {
        return this.sessions;
    }
}
