import { Request, Response } from 'express';
import { Pool } from 'pg';
import { WhatsappSessionManager } from '@antigravity/whatsapp-core';
import { logger } from '../../infrastructure/logger';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';

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
            await this.sessionManager.destroySession(tenantId);

            const client = await this.sessionManager.createSession(tenantId);
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
                client = await this.sessionManager.createSession(tenantId);
            }

            const code = await client.getPairingCode(phoneNumber);
            res.json({ success: true, code });
        } catch (error: any) {
            logger.error({ err: error, tenantId }, 'Erro ao gerar código de pareamento');
            res.status(500).json({ error: error.message || 'Erro ao obter código de pareamento' });
        }
    };
}
