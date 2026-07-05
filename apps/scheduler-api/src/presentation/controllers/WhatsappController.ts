import { Request, Response } from 'express';
import { Pool } from 'pg';
import { WhatsappSessionManager } from '../../infrastructure/whatsapp/WhatsappSessionManager';
import { logger } from '../../infrastructure/logger/logger';

interface AuthenticatedRequest extends Request {
    tenantId?: string;
    tenantEmail?: string;
    tenantPlan?: string;
}

export class WhatsappController {
    constructor(
        private readonly sessionManager: WhatsappSessionManager,
        private readonly dbPool?: Pool
    ) {}

    connect = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const tenantId = req.tenantId;
        if (!tenantId) {
            res.status(401).json({ error: 'Não autorizado' });
            return;
        }

        try {
            // Destruir sessão anterior (se existir) para garantir geração de novo QR.
            // Sem isso, se o socket antigo ainda está em memória com isReconnecting=true,
            // createSession retorna o objeto antigo e nenhum QR é gerado.
            await this.sessionManager.destroySession(tenantId);

            const client = await this.sessionManager.createSession(tenantId);
            if (!client) {
                res.status(503).json({ error: 'Outra instância do servidor já está conectando o WhatsApp deste tenant. Tente novamente em alguns segundos.' });
                return;
            }
            res.json({
                success: true,
                message: 'Inicializando conexão do WhatsApp...',
                connected: client.isConnected()
            });
        } catch (error: any) {
            logger.error({ err: error, tenantId }, 'Erro ao conectar WhatsApp para tenant');
            res.status(500).json({ error: 'Falha ao inicializar conexão do WhatsApp' });
        }
    };

    getStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const tenantId = req.tenantId;
        if (!tenantId) {
            res.status(401).json({ error: 'Não autorizado' });
            return;
        }

        try {
            const client = await this.sessionManager.getSession(tenantId);
            if (!client) {
                res.json({ connected: false, status: 'disconnected' });
                return;
            }

            const connected = client.isConnected();
            res.json({ 
                connected, 
                status: connected ? 'connected' : 'connecting',
                hasQr: !!client.getLastQrDataUrl()
            });
        } catch (error: any) {
            logger.error({ err: error, tenantId }, 'Erro ao buscar status do WhatsApp');
            res.status(500).json({ error: 'Erro ao obter status da conexão' });
        }
    };

    disconnect = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const tenantId = req.tenantId;
        if (!tenantId) {
            res.status(401).json({ error: 'Não autorizado' });
            return;
        }

        try {
            await this.sessionManager.destroySession(tenantId);
            res.json({ success: true, message: 'WhatsApp desconectado com sucesso.' });
        } catch (error: any) {
            logger.error({ err: error, tenantId }, 'Erro ao desconectar WhatsApp');
            res.status(500).json({ error: 'Erro ao desconectar' });
        }
    };

    /**
     * Limpa forçadamente a sessão do banco e da memória sem depender de
     * conexão WebSocket ativa. Usar quando disconnect normal falha ou
     * a sessão está em estado corrompido/irrecuperável.
     */
    clearSession = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const tenantId = req.tenantId;
        if (!tenantId) {
            res.status(401).json({ error: 'Não autorizado' });
            return;
        }

        try {
            // 1. Remover da memória (sem chamar logout no WS — pode estar morto)
            await this.sessionManager.forceRemoveSession(tenantId);

            // 2. Apagar TODAS as chaves Signal do banco
            if (this.dbPool) {
                await this.dbPool.query(
                    'DELETE FROM whatsapp_auth WHERE tenant_id = $1::uuid',
                    [tenantId]
                );
                await this.dbPool.query(
                    'UPDATE tenants SET whatsapp_connected = FALSE WHERE id = $1::uuid',
                    [tenantId]
                );
            }

            logger.info({ tenantId }, '🗑️ Sessão WhatsApp limpa forçadamente (banco + memória).');
            res.json({ success: true, message: 'Sessão limpa. Reconecte via QR Code.' });
        } catch (error: any) {
            logger.error({ err: error, tenantId }, 'Erro ao limpar sessão forçadamente');
            res.status(500).json({ error: 'Erro ao limpar sessão' });
        }
    };

    getQr = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const tenantId = req.tenantId;
        if (!tenantId) {
            res.status(401).json({ error: 'Não autorizado' });
            return;
        }

        try {
            const client = await this.sessionManager.getSession(tenantId);
            if (!client) {
                res.status(404).json({ error: 'Sessão do WhatsApp não encontrada. Inicialize a conexão primeiro.' });
                return;
            }

            const qr = client.getLastQrDataUrl();
            if (!qr) {
                res.status(404).json({ error: 'QR Code não disponível ou WhatsApp já conectado.' });
                return;
            }

            res.json({ qr });
        } catch (error: any) {
            logger.error({ err: error, tenantId }, 'Erro ao buscar QR Code');
            res.status(500).json({ error: 'Erro ao obter QR Code' });
        }
    };

    getDiagnostics = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const tenantId = req.tenantId;
        if (!tenantId) {
            res.status(401).json({ error: 'Não autorizado' });
            return;
        }

        try {
            const client = await this.sessionManager.getSession(tenantId);
            if (!client) {
                res.status(404).json({ error: 'Sessão do WhatsApp não encontrada' });
                return;
            }

            const diagnostics = await client.getDiagnostics();
            res.json(diagnostics);
        } catch (error: any) {
            logger.error({ err: error, tenantId }, 'Erro ao rodar diagnóstico do WhatsApp');
            res.status(500).json({ error: 'Erro ao rodar diagnóstico' });
        }
    };

    getGroups = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const tenantId = req.tenantId;
        if (!tenantId) {
            res.status(401).json({ error: 'Não autorizado' });
            return;
        }

        try {
            const client = await this.sessionManager.getSession(tenantId);
            if (!client || !client.isConnected()) {
                res.status(503).json({ error: 'WhatsApp não está conectado' });
                return;
            }

            const groups = await client.getGroups();
            res.json(groups);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    };

    getContacts = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const tenantId = req.tenantId;
        if (!tenantId) {
            res.status(401).json({ error: 'Não autorizado' });
            return;
        }

        try {
            // Leitura direta do banco com prioridade ao nome da agenda do Google
            // (google_name) sobre o nome sincronizado via WhatsApp. A lista é útil
            // mesmo sem sessão ativa, então não exigimos conexão aqui.
            if (this.dbPool) {
                const result = await this.dbPool.query(
                    `SELECT id, COALESCE(NULLIF(alias_name, ''), NULLIF(google_name, ''), name) AS name
                     FROM whatsapp_contacts
                     WHERE tenant_id = $1::uuid
                     ORDER BY COALESCE(NULLIF(alias_name, ''), NULLIF(google_name, ''), name) ASC;`,
                    [tenantId]
                );
                res.json(result.rows);
                return;
            }

            const client = await this.sessionManager.getSession(tenantId);
            if (!client) {
                res.status(503).json({ error: 'WhatsApp não está conectado' });
                return;
            }

            const contacts = await client.getContacts();
            res.json(contacts);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    };

    getPairingCode = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const tenantId = req.tenantId;
        if (!tenantId) {
            res.status(401).json({ error: 'Não autorizado' });
            return;
        }

        const { phoneNumber } = req.body;
        if (!phoneNumber) {
            res.status(400).json({ error: 'Número de telefone é obrigatório' });
            return;
        }

        try {
            let client = await this.sessionManager.getSession(tenantId);
            if (!client) {
                // Inicializa a sessão se não estiver ativa
                client = await this.sessionManager.createSession(tenantId);
            }
            if (!client) {
                res.status(503).json({ error: 'Outra instância do servidor já está conectando o WhatsApp deste tenant. Tente novamente em alguns segundos.' });
                return;
            }

            const code = await client.getPairingCode(phoneNumber);
            res.json({ success: true, code });
        } catch (error: any) {
            logger.error({ err: error, tenantId }, 'Erro ao gerar código de pareamento');
            res.status(500).json({ error: error.message || 'Erro ao obter código de pareamento' });
        }
    };
}
