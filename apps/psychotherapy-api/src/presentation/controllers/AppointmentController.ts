import { Request, Response } from 'express';
import { injectable } from 'tsyringe';
import { SavePsychotherapyAppointmentUseCase } from '../../application/useCases/SavePsychotherapyAppointmentUseCase';
import { ListPsychotherapyAppointmentsUseCase } from '../../application/useCases/ListPsychotherapyAppointmentsUseCase';
import { DeletePsychotherapyAppointmentUseCase } from '../../application/useCases/DeletePsychotherapyAppointmentUseCase';
import { UpdateAppointmentStatusUseCase } from '../../application/useCases/UpdateAppointmentStatusUseCase';
import { AppointmentStatus } from '../../domain/models/PsychotherapyAppointment';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { AppError } from '../../domain/errors/AppError';

@injectable()
export class AppointmentController {
    constructor(
        private readonly saveUseCase: SavePsychotherapyAppointmentUseCase,
        private readonly listUseCase: ListPsychotherapyAppointmentsUseCase,
        private readonly deleteUseCase: DeletePsychotherapyAppointmentUseCase,
        private readonly updateStatusUseCase: UpdateAppointmentStatusUseCase
    ) {}

    async saveAppointment(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        const appointment = await this.saveUseCase.execute({ tenantId, ...req.body });
        return res.status(req.body.id ? 200 : 201).json({ data: appointment });
    }

    async listAppointments(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        const { patientId, start, end, page, limit } = req.query as any;

        const result = await this.listUseCase.execute(tenantId, {
            patientId,
            start,
            end,
            page,
            limit
        });

        return res.status(200).json({
            data: result.data,
            meta: {
                total: result.total,
                page: page ?? 1,
                limit: limit ?? 50,
                totalPages: Math.ceil(result.total / (limit ?? 50))
            }
        });
    }

    async deleteAppointment(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        const mode = (req.query.mode as 'single' | 'future' | 'all') ?? 'single';
        await this.deleteUseCase.execute(tenantId, req.params.id, mode);
        return res.status(204).send();
    }

    async updateStatus(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        const { status } = req.body as { status: AppointmentStatus };
        const appointment = await this.updateStatusUseCase.execute(tenantId, req.params.id, status);
        return res.status(200).json({ data: appointment });
    }

    private getTenantId(req: Request): string {
        const tenantId = (req as AuthenticatedRequest).tenantId || (req as AuthenticatedRequest).userId;
        if (!tenantId) throw new AppError('Tenant não identificado', 401);
        return tenantId;
    }
}
