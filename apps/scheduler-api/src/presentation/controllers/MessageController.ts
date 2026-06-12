import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ScheduleMessageUseCase } from '../../application/useCases/ScheduleMessageUseCase';
import { ListMessagesUseCase } from '../../application/useCases/ListMessagesUseCase';
import { DeleteMessageUseCase } from '../../application/useCases/DeleteMessageUseCase';
import { UpdateMessageUseCase } from '../../application/useCases/UpdateMessageUseCase';
import { WeeklyReportUseCase } from '../../application/useCases/WeeklyReportUseCase';
import { MessageFilters } from '../../domain/repositories/IMessageRepository';

export class MessageController {
    constructor(
        private readonly scheduleMessageUseCase: ScheduleMessageUseCase,
        private readonly listMessagesUseCase: ListMessagesUseCase,
        private readonly deleteMessageUseCase: DeleteMessageUseCase,
        private readonly updateMessageUseCase: UpdateMessageUseCase,
        private readonly weeklyReportUseCase: WeeklyReportUseCase
    ) {}

    private processBase64Image(imageBase64: string, tenantId: string): string {
        const matches = imageBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) {
            throw new Error('Formato da imagem base64 inválido.');
        }

        const mimeType = matches[1];
        const allowedMimeTypes: Record<string, string> = {
            'image/png': 'png',
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/webp': 'webp',
            'image/gif': 'gif'
        };
        const ext = allowedMimeTypes[mimeType];
        if (!ext) {
            throw new Error('Apenas imagens (PNG, JPEG, WEBP, GIF) são permitidas.');
        }

        const buffer = Buffer.from(matches[2], 'base64');
        const maxSize = 5 * 1024 * 1024;
        if (buffer.length > maxSize) {
            throw new Error('A imagem anexada ultrapassa o limite de tamanho máximo permitido (5MB).');
        }

        const safeTenantId = String(tenantId || '').replace(/[^a-zA-Z0-9_-]/g, '');
        if (!safeTenantId) {
            throw new Error('Tenant inválido para armazenamento de upload.');
        }

        const filename = `${crypto.randomUUID()}.${ext}`;
        const uploadsRoot = path.resolve(__dirname, '../../../public/uploads');
        const tenantDir = path.resolve(uploadsRoot, safeTenantId);
        if (!tenantDir.startsWith(`${uploadsRoot}${path.sep}`)) {
            throw new Error('Caminho de upload inválido.');
        }

        if (!fs.existsSync(tenantDir)) {
            fs.mkdirSync(tenantDir, { recursive: true });
        }

        const filepath = path.resolve(tenantDir, filename);
        if (!filepath.startsWith(`${tenantDir}${path.sep}`)) {
            throw new Error('Caminho de arquivo inválido.');
        }

        fs.writeFileSync(filepath, buffer);
        return `/uploads/${safeTenantId}/${filename}`;
    }

    async schedule(req: Request, res: Response): Promise<Response> {
        try {
            const userId = (req as any).userId;
            const { content, recipientId, sendAt, platform, recurrence, imageBase64 } = req.body;

            let imageUrl = undefined;
            if (imageBase64) {
                imageUrl = this.processBase64Image(imageBase64, userId);
            }

            const sendAtDate = new Date(sendAt);
            if (isNaN(sendAtDate.getTime())) {
                return res.status(400).json({ error: "Invalid 'sendAt' date format" });
            }

            const result = await this.scheduleMessageUseCase.execute({
                userId,
                content,
                recipientId,
                sendAt: sendAtDate,
                platform,
                recurrence,
                imageUrl
            });

            return res.status(201).json({
                message: "Message scheduled successfully",
                data: result,
                debugBody: req.body
            });

        } catch (error: any) {
            return res.status(400).json({ error: error.message || 'An unexpected error occurred' });
        }
    }

    async list(req: Request, res: Response): Promise<Response> {
        try {
            const userId = (req as any).userId;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;

            const { date, startDate, endDate } = req.query;
            const filters: MessageFilters = {};
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

            if (date) {
                const dateStr = date as string;
                if (!dateRegex.test(dateStr)) {
                    return res.status(400).json({ error: "Formato de data inválido para o parâmetro 'date'. Use YYYY-MM-DD." });
                }
                const start = new Date(`${dateStr}T00:00:00.000`);
                const end = new Date(`${dateStr}T23:59:59.999`);
                if (isNaN(start.getTime()) || isNaN(end.getTime())) {
                    return res.status(400).json({ error: "Data 'date' fornecida é inválida." });
                }
                filters.startDate = start;
                filters.endDate = end;
            } else {
                if (startDate) {
                    const startStr = startDate as string;
                    let start: Date;
                    if (dateRegex.test(startStr)) {
                        start = new Date(`${startStr}T00:00:00.000`);
                    } else {
                        start = new Date(startStr);
                    }
                    if (isNaN(start.getTime())) {
                        return res.status(400).json({ error: "Data de início ('startDate') inválida." });
                    }
                    filters.startDate = start;
                }

                if (endDate) {
                    const endStr = endDate as string;
                    let end: Date;
                    if (dateRegex.test(endStr)) {
                        end = new Date(`${endStr}T23:59:59.999`);
                    } else {
                        end = new Date(endStr);
                    }
                    if (isNaN(end.getTime())) {
                        return res.status(400).json({ error: "Data de fim ('endDate') inválida." });
                    }
                    filters.endDate = end;
                }
            }

            const result = await this.listMessagesUseCase.execute(userId, page, limit, filters);
            return res.status(200).json(result);
        } catch (error: any) {
            console.error('[BACKEND] Erro ao listar mensagens:', error);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    async update(req: Request, res: Response): Promise<Response> {
        try {
            const userId = (req as any).userId;
            const { id } = req.params;
            const { content, recipientId, sendAt, platform, recurrence, imageBase64 } = req.body;

            let imageUrl = undefined;
            if (imageBase64) {
                imageUrl = this.processBase64Image(imageBase64, userId);
            }

            const sendAtDate = sendAt ? new Date(sendAt) : undefined;
            if (sendAtDate && isNaN(sendAtDate.getTime())) {
                return res.status(400).json({ error: "Invalid 'sendAt' date format" });
            }

            const result = await this.updateMessageUseCase.execute({
                id,
                userId,
                content,
                recipientId,
                sendAt: sendAtDate,
                platform,
                recurrence,
                imageUrl
            });

            console.log(`[BACKEND] Sucesso ao atualizar mensagem ${id}`);
            return res.status(200).json({
                message: 'Message updated successfully',
                data: result
            });
        } catch (error: any) {
            return res.status(400).json({ error: error.message || 'An unexpected error occurred' });
        }
    }

    async delete(req: Request, res: Response): Promise<Response> {
        try {
            const userId = (req as any).userId;
            const { id } = req.params;
            await this.deleteMessageUseCase.execute(id, userId);
            return res.status(200).json({ message: "Message deleted successfully" });
        } catch (error: any) {
            return res.status(400).json({ error: error.message || 'An unexpected error occurred' });
        }
    }

    async weeklyReport(req: Request, res: Response): Promise<Response | void> {
        try {
            const userId = (req as any).userId;
            const recipientId = req.query.recipientId as string | undefined;
            const stats = await this.weeklyReportUseCase.execute(userId, recipientId);

            if (req.query.export === 'csv') {
                const headers = ['ID', 'Destinatário', 'Data de Agendamento/Envio', 'Plataforma', 'Status', 'Conteúdo'];
                const csvLines = [headers.map(h => `"${h}"`).join(';')];

                for (const msg of stats.sentMessagesList) {
                    const formattedDate = new Date(msg.sendAt).toLocaleString('pt-BR');
                    const escapedContent = (msg.content || '').replace(/"/g, '""');
                    const row = [
                        msg.id,
                        msg.recipientId,
                        formattedDate,
                        msg.platform,
                        msg.status,
                        escapedContent
                    ];
                    csvLines.push(row.map(cell => `"${cell}"`).join(';'));
                }

                const csvString = csvLines.join('\n');
                res.setHeader('Content-Type', 'text/csv; charset=utf-8');
                res.setHeader('Content-Disposition', 'attachment; filename="relatorio_semanal.csv"');
                return res.status(200).send(csvString);
            }

            return res.status(200).json(stats);
        } catch (error: any) {
            return res.status(500).json({ error: error.message || 'An unexpected error occurred' });
        }
    }
}
