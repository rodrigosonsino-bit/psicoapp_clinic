import { Request, Response } from 'express';
import { DeletePsychotherapyPatientUseCase } from '../../application/useCases/DeletePsychotherapyPatientUseCase';
import { GeneratePsychotherapyMonthUseCase } from '../../application/useCases/GeneratePsychotherapyMonthUseCase';
import { ListPsychotherapyMonthUseCase } from '../../application/useCases/ListPsychotherapyMonthUseCase';
import { ListPsychotherapyPatientsUseCase } from '../../application/useCases/ListPsychotherapyPatientsUseCase';
import { SavePsychotherapyMonthlyRecordUseCase } from '../../application/useCases/SavePsychotherapyMonthlyRecordUseCase';
import { SavePsychotherapyPatientUseCase } from '../../application/useCases/SavePsychotherapyPatientUseCase';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { AppError } from '../../domain/errors/AppError';
import { injectable } from 'tsyringe';

@injectable()
export class PsychotherapyController {
    constructor(
        private readonly listPatientsUseCase: ListPsychotherapyPatientsUseCase,
        private readonly savePatientUseCase: SavePsychotherapyPatientUseCase,
        private readonly deletePatientUseCase: DeletePsychotherapyPatientUseCase,
        private readonly listMonthUseCase: ListPsychotherapyMonthUseCase,
        private readonly saveMonthlyRecordUseCase: SavePsychotherapyMonthlyRecordUseCase,
        private readonly generateMonthUseCase: GeneratePsychotherapyMonthUseCase
    ) {}

    async listPatients(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        const { page, limit, search } = req.query as any;

        const result = await this.listPatientsUseCase.execute(tenantId, page, limit, search);

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

    async savePatient(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        const patient = await this.savePatientUseCase.execute({ tenantId, ...req.body });
        return res.status(req.body.id ? 200 : 201).json({ data: patient });
    }

    async deletePatient(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        await this.deletePatientUseCase.execute(tenantId, req.params.id);
        return res.status(204).send();
    }

    async getMonth(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        const result = await this.listMonthUseCase.execute(tenantId, req.params.month);
        return res.status(200).json(result);
    }

    async saveMonthlyRecord(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        const record = await this.saveMonthlyRecordUseCase.execute({
            tenantId,
            month: req.params.month,
            ...req.body
        });
        return res.status(req.body.id ? 200 : 201).json({ data: record });
    }

    async generateMonth(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        const records = await this.generateMonthUseCase.execute(tenantId, req.params.month);
        return res.status(201).json({ data: records });
    }

    private getTenantId(req: Request): string {
        const tenantId = (req as AuthenticatedRequest).tenantId || (req as AuthenticatedRequest).userId;
        if (!tenantId) throw new AppError('Tenant não identificado', 401);
        return tenantId;
    }
}
