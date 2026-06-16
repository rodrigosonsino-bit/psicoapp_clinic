import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';
import { PsychotherapyMonthlyRecord } from '../../domain/models/PsychotherapyMonthlyRecord';
import { PASTORAL_SENTINEL_EMAIL } from '../../domain/constants/pastoral';

const EXPECTED_SESSIONS_BY_STATUS = {
    weekly: 4,
    biweekly: 2,
    one_off: 0,
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

        // Skip inactive patients — they don't generate monthly records.
        const activePatients = patients.filter(p => p.status !== 'inactive' && p.email !== PASTORAL_SENTINEL_EMAIL);

        if (activePatients.length === 0) return [];

        // Conta agendamentos reais do mês por paciente para detectar a 5ª semana.
        // Usa query de agregação direta — sem paginação, sem carregar campos desnecessários.
        const scheduledCounts = await this.repository.countScheduledSessionsByPatient(tenantId, month);

        return this.repository.bulkSaveMonthlyRecords(
            activePatients.map(patient => {
                const defaultSessions = EXPECTED_SESSIONS_BY_STATUS[patient.status];
                const actualSessions  = scheduledCounts.get(patient.id) ?? 0;

                // Se houver agendamentos reais, usa o maior valor (cobre o mês de 5 semanas).
                // Se a agenda ainda não foi montada, cai no padrão.
                const expectedSessions = actualSessions > 0
                    ? Math.max(defaultSessions, actualSessions)
                    : defaultSessions;

                return {
                    tenantId,
                    patientId: patient.id,
                    month,
                    patientNameSnapshot: patient.name,
                    status: patient.status,
                    paymentType: patient.paymentType,
                    sessionPriceCents: patient.defaultSessionPriceCents,
                    expectedSessions,
                    paidSessions: 0,
                    absences: 0,
                    paymentStatus: 'pending' as const,
                    notes: patient.notes,
                    previousMonthPaidCents: 0,
                };
            })
        );
    }
}
