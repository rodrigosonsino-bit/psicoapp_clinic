import { Response } from 'express';
import { injectable, inject } from 'tsyringe';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { SavePsychotherapySessionUseCase } from '../../application/useCases/SavePsychotherapySessionUseCase';
import { ListPsychotherapySessionsUseCase } from '../../application/useCases/ListPsychotherapySessionsUseCase';
import { DeletePsychotherapySessionUseCase } from '../../application/useCases/DeletePsychotherapySessionUseCase';

@injectable()
export class SessionController {
    constructor(
        @inject(SavePsychotherapySessionUseCase) private saveSessionUseCase: SavePsychotherapySessionUseCase,
        @inject(ListPsychotherapySessionsUseCase) private listSessionsUseCase: ListPsychotherapySessionsUseCase,
        @inject(DeletePsychotherapySessionUseCase) private deleteSessionUseCase: DeletePsychotherapySessionUseCase
    ) {}

    async saveSession(req: AuthenticatedRequest, res: Response): Promise<void> {
        const tenantId = req.tenantId!;
        const data = { ...req.body, tenantId };
        const session = await this.saveSessionUseCase.execute(data);
        res.status(201).json(session);
    }

    async listSessions(req: AuthenticatedRequest, res: Response): Promise<void> {
        const tenantId = req.tenantId!;
        const { patientId, start, end, page, limit } = req.query as any;

        const result = await this.listSessionsUseCase.execute(
            tenantId,
            patientId,
            start,
            end,
            page,
            limit
        );
        res.status(200).json({
            data: result.data,
            meta: {
                total: result.total,
                page,
                limit,
                totalPages: Math.ceil(result.total / limit)
            }
        });
    }

    async deleteSession(req: AuthenticatedRequest, res: Response): Promise<void> {
        const tenantId = req.tenantId!;
        const { id } = req.params;
        await this.deleteSessionUseCase.execute(tenantId, id);
        res.status(204).send();
    }
}
