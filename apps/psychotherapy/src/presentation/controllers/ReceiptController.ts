import { Request, Response } from 'express';
import { injectable } from 'tsyringe';
import { IssuePsychotherapyReceiptUseCase } from '../../application/useCases/IssuePsychotherapyReceiptUseCase';
import { ListPsychotherapyReceiptsUseCase } from '../../application/useCases/ListPsychotherapyReceiptsUseCase';
import { AppError } from '../../domain/errors/AppError';

@injectable()
export class ReceiptController {
    constructor(
        private readonly issueReceiptUseCase: IssuePsychotherapyReceiptUseCase,
        private readonly listReceiptsUseCase: ListPsychotherapyReceiptsUseCase
    ) {}

    issueReceipt = async (req: Request, res: Response): Promise<void> => {
        const tenantId = (req as any).tenantId || (req as any).userId;
        if (!tenantId) throw new AppError('Tenant não identificado', 401);

        const { patientId, amountCents, issueDate, description, markMonthAsPaid } = req.body;

        const receipt = await this.issueReceiptUseCase.execute({
            tenantId,
            patientId,
            amountCents,
            issueDate, // Already parsed as Date object by Zod validation middleware
            description,
            markMonthAsPaid
        });

        res.status(201).json(receipt.toJSON());
    };

    listReceipts = async (req: Request, res: Response): Promise<void> => {
        const tenantId = (req as any).tenantId || (req as any).userId;
        if (!tenantId) throw new AppError('Tenant não identificado', 401);

        const patientId = req.query.patientId as string | undefined;

        const receipts = await this.listReceiptsUseCase.execute(tenantId, patientId);
        res.status(200).json(receipts.map(r => r.toJSON()));
    };
}
