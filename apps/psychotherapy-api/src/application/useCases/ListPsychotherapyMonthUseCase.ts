import { injectable, inject } from 'tsyringe';
import { PsychotherapyMonthlyRecord } from '../../domain/models/PsychotherapyMonthlyRecord';
import { PsychotherapyPatient } from '../../domain/models/PsychotherapyPatient';
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
        const [allRecords, allPatients] = await Promise.all([
            this.repository.listMonthlyRecords(tenantId, month),
            this.repository.listPatients(tenantId) as Promise<PsychotherapyPatient[]>
        ]);

        // Pacientes inativos e membros só-de-grupo (individual_therapy_enabled=false) somem
        // da tela de Faturamento Mensal (mas continuam existindo no banco/CSV export/emissão
        // de recibo — só a listagem exibida aqui é filtrada). Usa o status/flag ATUAIS do
        // paciente, não o snapshot congelado em monthly_records.status — esse snapshot só é
        // resincronizado quando algo dispara syncMonthlyRecord (mudança de status de
        // agendamento) ou quando o paciente é salvo no mês CORRENTE; meses passados (ou
        // pacientes cujo status/flag mudou sem nenhum desses gatilhos) ficavam desatualizados
        // indefinidamente (achado em 2026-07-05: caso Letícia Deolin, e 17 membros do grupo
        // CURSOTERAPIA_QUINTA_TURMA02 criados sem individual_therapy_enabled=false).
        // Busca todos os pacientes (não só listIndividualPatientsForBilling) porque aqui
        // precisamos decidir se ESCONDE um paciente com o flag false — o outro método já
        // filtra esses fora antes de eu conseguir checar o flag dele.
        const patientById = new Map(allPatients.map(p => [p.id, p]));
        const records = allRecords.filter(r => {
            // Registro sem paciente vinculado (patientId null): não há paciente "atual" pra
            // checar, então o próprio snapshot do registro é a única fonte de verdade.
            if (!r.patientId) return r.status !== 'inactive';

            const patient = patientById.get(r.patientId);
            // patientId aponta pra um paciente que não existe mais em listPatients (excluído/
            // soft-deleted) — o registro ficou órfão. Esconde: paciente excluído não deveria
            // aparecer no Faturamento Mensal independente do snapshot congelado (achado em
            // 2026-07-05 — vários membros do grupo CURSOTERAPIA_QUINTA_TURMA02 foram excluídos
            // como pacientes individuais em 03/07, mas os registros mensais deles continuaram
            // órfãos no banco com o snapshot antigo "weekly").
            if (!patient) return false;

            return patient.status !== 'inactive' && patient.individualTherapyEnabled;
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
