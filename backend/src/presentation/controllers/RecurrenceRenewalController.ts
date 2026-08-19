import { Request, Response } from 'express';
import { injectable } from 'tsyringe';
import { ListPendingRecurrenceRenewalsUseCase } from '../../application/useCases/ListPendingRecurrenceRenewalsUseCase';
import { RenewRecurrenceSeriesUseCase } from '../../application/useCases/RenewRecurrenceSeriesUseCase';
import { DismissRecurrenceRenewalUseCase } from '../../application/useCases/DismissRecurrenceRenewalUseCase';
import { AppError } from '../../domain/errors/AppError';

@injectable()
export class RecurrenceRenewalController {
    constructor(
        private readonly listPendingUseCase: ListPendingRecurrenceRenewalsUseCase,
        private readonly renewUseCase: RenewRecurrenceSeriesUseCase,
        private readonly dismissUseCase: DismissRecurrenceRenewalUseCase
    ) {}

    listPending = async (req: Request, res: Response): Promise<void> => {
        const tenantId = (req as any).tenantId || (req as any).userId;
        if (!tenantId) throw new AppError('Tenant não identificado', 401);

        const notices = await this.listPendingUseCase.execute(tenantId);
        res.status(200).json({ data: notices });
    };

    renew = async (req: Request, res: Response): Promise<void> => {
        const tenantId = (req as any).tenantId || (req as any).userId;
        if (!tenantId) throw new AppError('Tenant não identificado', 401);

        const { appointmentId } = req.params;
        const additionalMonths = Number(req.body?.additionalMonths);

        const appointment = await this.renewUseCase.execute(tenantId, appointmentId, additionalMonths);
        res.status(200).json({ data: appointment });
    };

    dismiss = async (req: Request, res: Response): Promise<void> => {
        const tenantId = (req as any).tenantId || (req as any).userId;
        if (!tenantId) throw new AppError('Tenant não identificado', 401);

        const { appointmentId } = req.params;
        await this.dismissUseCase.execute(tenantId, appointmentId);
        res.status(200).json({ message: 'Aviso dispensado' });
    };
}
