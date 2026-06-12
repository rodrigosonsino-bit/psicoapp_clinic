import { injectable, inject } from 'tsyringe';
import { PsychotherapyReceipt } from '../../domain/models/PsychotherapyReceipt';
import { IPsychotherapyRepository, SaveReceiptDTO } from '../../domain/repositories/IPsychotherapyRepository';
import { AppError } from '../../domain/errors/AppError';

export interface IssueReceiptRequestDTO {
    tenantId: string;
    patientId: string;
    amountCents: number;
    issueDate?: Date;
    description: string;
    markMonthAsPaid?: string; // e.g. "2023-10" to automatically mark a month as paid
}

@injectable()
export class IssuePsychotherapyReceiptUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async execute(data: IssueReceiptRequestDTO): Promise<PsychotherapyReceipt> {
        if (data.amountCents <= 0) {
            throw new AppError('O valor do recibo deve ser maior que zero', 400);
        }

        // 1. Verify if patient exists and belongs to the tenant
        const patient = await this.repository.findPatientById(data.tenantId, data.patientId);
        if (!patient) {
            throw new AppError('Paciente não encontrado', 404);
        }

        // 2. Issue the receipt
        const receiptDto: SaveReceiptDTO = {
            tenantId: data.tenantId,
            patientId: data.patientId,
            amountCents: data.amountCents,
            issueDate: data.issueDate || new Date(),
            description: data.description
        };

        const receipt = await this.repository.saveReceipt(receiptDto);

        // 3. Optional: Mark month as paid
        if (data.markMonthAsPaid) {
            const records = await this.repository.listMonthlyRecords(data.tenantId, data.markMonthAsPaid);
            const record = records.find(r => r.patientId === data.patientId);
            
            if (record) {
                await this.repository.saveMonthlyRecord({
                    id: record.id,
                    tenantId: record.tenantId,
                    patientId: record.patientId,
                    month: record.month,
                    patientNameSnapshot: record.patientNameSnapshot,
                    status: record.status,
                    paymentType: record.paymentType,
                    sessionPriceCents: record.sessionPriceCents,
                    expectedSessions: record.expectedSessions,
                    paidSessions: record.expectedSessions, // mark all expected as paid
                    absences: record.absences,
                    paymentStatus: 'paid',
                    notes: record.notes,
                    previousMonthPaidCents: record.previousMonthPaidCents
                });
            }
        }

        return receipt;
    }
}
