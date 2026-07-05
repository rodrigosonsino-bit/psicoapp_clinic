import { injectable, inject } from 'tsyringe';
import { PsychotherapyMonthlyRecord } from '../../domain/models/PsychotherapyMonthlyRecord';
import { IPsychotherapyRepository, PsychotherapyMonthSummary } from '../../domain/repositories/IPsychotherapyRepository';

export interface PsychotherapyMonthView {
    month: string;
    summary: PsychotherapyMonthSummary;
    records: PsychotherapyMonthlyRecord[];
}

@injectable()
export class ListPsychotherapyMonthUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    // Fix #5: single DB round-trip. Summary is computed in memory from the
    // records already fetched, instead of issuing a second identical query.
    async execute(tenantId: string, month: string): Promise<PsychotherapyMonthView> {
        const [allRecords, patients] = await Promise.all([
            this.repository.listMonthlyRecords(tenantId, month),
            this.repository.listIndividualPatientsForBilling(tenantId)
        ]);

        // Pacientes inativos somem da tela de Faturamento Mensal (mas continuam existindo
        // no banco/CSV export/emissão de recibo — só a listagem exibida aqui é filtrada).
        // Usa o status ATUAL do paciente, não o snapshot congelado em monthly_records.status
        // — esse snapshot só é resincronizado quando algo dispara syncMonthlyRecord (mudança
        // de status de agendamento) ou quando o paciente é salvo no mês CORRENTE; meses
        // passados (ou pacientes cujo status mudou sem nenhum desses gatilhos) ficavam com o
        // snapshot desatualizado indefinidamente (achado em 2026-07-05, caso Letícia Deolin).
        const statusByPatientId = new Map(patients.map(p => [p.id, p.status]));
        const records = allRecords.filter(r => {
            const liveStatus = r.patientId ? statusByPatientId.get(r.patientId) : undefined;
            return (liveStatus ?? r.status) !== 'inactive';
        });

        const summary = this.computeSummary(month, records);
        return { month, summary, records };
    }

    private computeSummary(month: string, records: PsychotherapyMonthlyRecord[]): PsychotherapyMonthSummary {
        return records.reduce<PsychotherapyMonthSummary>((acc, record) => {
            acc.totalPatients += 1;
            if (record.status === 'inactive') acc.inactivePatients += 1;
            else acc.activePatients += 1;

            if (record.paymentStatus === 'paid') acc.paidRecords += 1;
            if (record.paymentStatus === 'pending') acc.pendingRecords += 1;
            if (record.paymentStatus === 'partial') acc.partialRecords += 1;

            acc.expectedAmountCents += record.expectedAmountCents;
            acc.receivedAmountCents += record.receivedAmountCents;
            acc.pendingAmountCents += record.pendingAmountCents;
            acc.totalAbsences += record.absences;
            return acc;
        }, {
            month,
            totalPatients: 0,
            activePatients: 0,
            inactivePatients: 0,
            paidRecords: 0,
            pendingRecords: 0,
            partialRecords: 0,
            expectedAmountCents: 0,
            receivedAmountCents: 0,
            pendingAmountCents: 0,
            totalAbsences: 0
        });
    }
}
