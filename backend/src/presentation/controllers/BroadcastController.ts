import { Request, Response } from 'express';
import { injectable } from 'tsyringe';
import { PreviewBroadcastUseCase } from '../../application/useCases/PreviewBroadcastUseCase';
import { CreateBroadcastUseCase } from '../../application/useCases/CreateBroadcastUseCase';
import { GetBroadcastUseCase } from '../../application/useCases/GetBroadcastUseCase';
import { CancelBroadcastUseCase } from '../../application/useCases/CancelBroadcastUseCase';
import { IBroadcastRepository } from '../../domain/repositories/IBroadcastRepository';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { AppError } from '../../domain/errors/AppError';
import { inject } from 'tsyringe';

@injectable()
export class BroadcastController {
    constructor(
        private readonly previewUseCase: PreviewBroadcastUseCase,
        private readonly createUseCase: CreateBroadcastUseCase,
        private readonly getUseCase: GetBroadcastUseCase,
        private readonly cancelUseCase: CancelBroadcastUseCase,
        @inject('IBroadcastRepository') private readonly broadcastRepository: IBroadcastRepository
    ) {}

    async setPatientOptIn(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        const { optIn } = req.body as { optIn: boolean };
        await this.broadcastRepository.setPatientOptIn(tenantId, req.params.id, optIn);
        return res.status(204).send();
    }

    async preview(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        const preview = await this.previewUseCase.execute(tenantId);
        return res.status(200).json({ data: preview });
    }

    async create(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        const idempotencyKey = req.header('Idempotency-Key');
        if (!idempotencyKey) {
            throw new AppError('Header Idempotency-Key é obrigatório.', 400);
        }

        const broadcast = await this.createUseCase.execute({
            tenantId,
            idempotencyKey,
            content: req.body.message
        });

        return res.status(202).json({
            data: {
                id: broadcast.id,
                status: broadcast.status,
                totalRecipients: broadcast.totalRecipients,
                createdAt: broadcast.createdAt
            }
        });
    }

    async get(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        const { broadcast, counts } = await this.getUseCase.execute(tenantId, req.params.id);
        return res.status(200).json({ data: { ...broadcast, counts } });
    }

    async list(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
        const results = await this.getUseCase.list(tenantId, limit);
        return res.status(200).json({
            data: results.map(r => ({ ...r.broadcast, counts: r.counts }))
        });
    }

    async cancel(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        await this.cancelUseCase.execute(tenantId, req.params.id);
        return res.status(204).send();
    }

    private getTenantId(req: Request): string {
        const tenantId = (req as AuthenticatedRequest).tenantId || (req as AuthenticatedRequest).userId;
        if (!tenantId) throw new AppError('Tenant não identificado', 401);
        return tenantId;
    }
}
