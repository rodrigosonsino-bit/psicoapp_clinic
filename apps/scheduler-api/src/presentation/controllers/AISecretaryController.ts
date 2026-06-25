import { Request, Response } from 'express';
import { GeminiClient } from '../../infrastructure/gemini/GeminiClient';
import { logger } from '../../infrastructure/logger/logger';

export class AISecretaryController {
    constructor(private readonly geminiClient: GeminiClient) {}

    async handlePrompt(req: Request, res: Response): Promise<void> {
        try {
            const { prompt, currentContent } = req.body;
            const tenantId = (req as any).tenantId;
            if (!prompt || typeof prompt !== 'string') {
                res.status(400).json({ error: 'O campo "prompt" é obrigatório e deve ser uma string.' });
                return;
            }

            logger.info({ tenantId, promptLength: prompt?.length }, 'Processando solicitação com a IA Secretária');
            const response = await this.geminiClient.processPrompt(prompt, currentContent, tenantId);
            
            res.json(response);
        } catch (error: any) {
            logger.error({ error }, 'Erro no controlador da IA Secretária');
            res.status(500).json({ error: error.message });
        }
    }

    async getSettings(req: Request, res: Response): Promise<void> {
        try {
            const tenantId = (req as any).tenantId;
            const settings = await this.geminiClient.getAISettings(tenantId);
            res.json(settings);
        } catch (error: any) {
            logger.error({ error }, 'Erro ao buscar configurações da IA');
            res.status(500).json({ error: error.message });
        }
    }

    async saveSettings(req: Request, res: Response): Promise<void> {
        try {
            const tenantId = (req as any).tenantId;
            const { enabled, instructions, officeHours, receiveWeeklyReport } = req.body;
            
            if (typeof enabled !== 'boolean') {
                res.status(400).json({ error: 'Parâmetro enabled é obrigatório e deve ser booleano' });
                return;
            }

            await this.geminiClient.updateAISettings(tenantId, enabled, instructions, officeHours, receiveWeeklyReport);
            res.json({ success: true, enabled, instructions, officeHours, receiveWeeklyReport });
        } catch (error: any) {
            logger.error({ error }, 'Erro ao salvar configurações da IA');
            res.status(500).json({ error: error.message });
        }
    }
}
