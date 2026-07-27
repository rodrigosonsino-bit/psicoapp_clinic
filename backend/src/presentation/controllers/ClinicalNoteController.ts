import { Request, Response } from 'express';
import { injectable } from 'tsyringe';
import { SaveClinicalNoteUseCase } from '../../application/useCases/SaveClinicalNoteUseCase';
import { ListClinicalNotesUseCase } from '../../application/useCases/ListClinicalNotesUseCase';
import { DeleteClinicalNoteUseCase } from '../../application/useCases/DeleteClinicalNoteUseCase';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { AppError } from '../../domain/errors/AppError';

import { ApproveClinicalNoteUseCase } from '../../application/useCases/ApproveClinicalNoteUseCase';

@injectable()
export class ClinicalNoteController {
    constructor(
        private readonly saveUseCase: SaveClinicalNoteUseCase,
        private readonly listUseCase: ListClinicalNotesUseCase,
        private readonly deleteUseCase: DeleteClinicalNoteUseCase,
        private readonly approveUseCase: ApproveClinicalNoteUseCase
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

    async approveNote(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        const { id } = req.params;
        const { content, version } = req.body;

        if (!content || typeof content !== 'string' || content.trim().length === 0) {
            throw new AppError('O conteúdo do prontuário é obrigatório e não pode ser vazio.', 400);
        }

        const parsedVersion = Number(version);
        if (!Number.isInteger(parsedVersion) || parsedVersion <= 0) {
            throw new AppError('A versão informada é inválida.', 400);
        }

        const note = await this.approveUseCase.execute({ tenantId, noteId: id, content: content.trim(), version: parsedVersion });
        return res.status(200).json({ data: note });
    }

    private getTenantId(req: Request): string {
        const tenantId = (req as AuthenticatedRequest).tenantId || (req as AuthenticatedRequest).userId;
        if (!tenantId) throw new AppError('Tenant não identificado', 401);
        return tenantId;
    }
}
