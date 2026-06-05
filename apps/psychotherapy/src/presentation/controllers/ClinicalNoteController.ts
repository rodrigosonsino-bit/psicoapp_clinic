import { Request, Response } from 'express';
import { injectable } from 'tsyringe';
import { SaveClinicalNoteUseCase } from '../../application/useCases/SaveClinicalNoteUseCase';
import { ListClinicalNotesUseCase } from '../../application/useCases/ListClinicalNotesUseCase';
import { DeleteClinicalNoteUseCase } from '../../application/useCases/DeleteClinicalNoteUseCase';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { AppError } from '../../domain/errors/AppError';

@injectable()
export class ClinicalNoteController {
    constructor(
        private readonly saveUseCase: SaveClinicalNoteUseCase,
        private readonly listUseCase: ListClinicalNotesUseCase,
        private readonly deleteUseCase: DeleteClinicalNoteUseCase
    ) {}

    async saveNote(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        const { patientId } = req.params;
        const note = await this.saveUseCase.execute({ tenantId, patientId, ...req.body });
        return res.status(req.body.id ? 200 : 201).json({ data: note });
    }

    async listNotes(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        const { patientId } = req.params;
        const { page, limit } = req.query as any;

        const result = await this.listUseCase.execute(tenantId, patientId, page, limit);

        return res.status(200).json({
            data: result.data,
            meta: {
                total: result.total,
                page,
                limit,
                totalPages: Math.ceil(result.total / limit)
            }
        });
    }

    async deleteNote(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        await this.deleteUseCase.execute(tenantId, req.params.id);
        return res.status(204).send();
    }

    private getTenantId(req: Request): string {
        const tenantId = (req as AuthenticatedRequest).tenantId || (req as AuthenticatedRequest).userId;
        if (!tenantId) throw new AppError('Tenant não identificado', 401);
        return tenantId;
    }
}
