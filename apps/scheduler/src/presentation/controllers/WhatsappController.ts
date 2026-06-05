import { Request, Response } from 'express';
import { WhatsappSessionManager } from '../../infrastructure/whatsapp/WhatsappSessionManager';
import { logger } from '../../infrastructure/logger/logger';

interface AuthenticatedRequest extends Request {
    tenantId?: string;
    tenantEmail?: string;
    tenantPlan?: string;
}

export class WhatsappController {
    constructor(private readonly sessionManager: WhatsappSessionManager) {}

    connect = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const tenantId = req.tenantId;
        if (!tenantId) {
            res.status(401).json({ error: 'Não autorizado' });
            return;
        }

        try {
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

            const code = await client.getPairingCode(phoneNumber);
            res.json({ success: true, code });
        } catch (error: any) {
            logger.error({ err: error, tenantId }, 'Erro ao gerar código de pareamento');
            res.status(500).json({ error: error.message || 'Erro ao obter código de pareamento' });
        }
    };
}
