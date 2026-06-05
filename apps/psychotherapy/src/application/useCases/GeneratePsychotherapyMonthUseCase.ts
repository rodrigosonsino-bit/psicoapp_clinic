import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';
import { PsychotherapyMonthlyRecord } from '../../domain/models/PsychotherapyMonthlyRecord';

const EXPECTED_SESSIONS_BY_STATUS = {
    weekly: 4,
    biweekly: 2,
    one_off: 1,
    inactive: 0
} as const;

@injectable()
export class GeneratePsychotherapyMonthUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async execute(tenantId: string, month: string): Promise<PsychotherapyMonthlyRecord[]> {
        if (!/^\d{4}-\d{2}$/.test(month)) {
            throw new Error('Mês inválido. Use o formato YYYY-MM');
        }

        const patients = await this.repository.listPatients(tenantId);

        // Fix #3: skip inactive patients — they don't generate monthly records.
        const activePatients = patients.filter(p => p.status !== 'inactive');

        if (activePatients.length === 0) return [];

        // Fix #4: single bulk INSERT instead of N sequential queries.
        return this.repository.bulkSaveMonthlyRecords(
            activePatients.map(patient => ({
                tenantId,
                patientId: patient.id,
                month,
                patientNameSnapshot: patient.name,
                status: patient.status,
                paymentType: patient.paymentType,
                sessionPriceCents: patient.defaultSessionPriceCents,
                expectedSessions: EXPECTED_SESSIONS_BY_STATUS[patient.status],
                paidSessions: 0,
                absences: 0,
                paymentStatus: 'pending' as const,
                notes: patient.notes,
                previousMonthPaidCents: 0
            }))
        );
    }
}
