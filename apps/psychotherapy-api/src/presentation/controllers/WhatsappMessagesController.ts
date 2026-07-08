import { Response } from 'express';
import { IWhatsappCloudRepository } from '../../domain/repositories/IWhatsappCloudRepository';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { AppError } from '../../domain/errors/AppError';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Histórico de conversa WhatsApp por paciente — SÓ VISUALIZAÇÃO, sem automação nenhuma.
 * Instanciado diretamente em server.ts (mesmo padrão de WhatsappCloudWebhookController), fora do
 * container tsyringe, já que depende do mesmo IWhatsappCloudRepository construído no bootstrap.
 */
export class WhatsappMessagesController {
    constructor(private readonly repository: IWhatsappCloudRepository) {}

    listForPatient = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
        const tenantId = req.tenantId || req.userId;
        if (!tenantId) throw new AppError('Tenant não identificado', 401);

        const { patientId } = req.params;
        const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
        const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(req.query.limit ?? String(DEFAULT_LIMIT)), 10) || DEFAULT_LIMIT));

        const result = await this.repository.listMessagesForPatient(tenantId, patientId, page, limit);

        return res.status(200).json({
            data: result.data,
            meta: {
                total: result.total,
                page,
                limit,
                totalPages: Math.ceil(result.total / limit),
            },
        });
    };
}
