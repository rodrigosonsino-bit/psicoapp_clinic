import { injectable, inject } from 'tsyringe';
import { PsychotherapyMonthlyRecord } from '../../domain/models/PsychotherapyMonthlyRecord';
import { IPsychotherapyRepository, SaveMonthlyRecordDTO } from '../../domain/repositories/IPsychotherapyRepository';

@injectable()
export class SavePsychotherapyMonthlyRecordUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async execute(data: SaveMonthlyRecordDTO): Promise<PsychotherapyMonthlyRecord> {
        if (!/^\d{4}-\d{2}$/.test(data.month)) {
            throw new Error('Mês inválido. Use o formato YYYY-MM');
        }

        const patientNameSnapshot = data.patientNameSnapshot.trim();
        if (!patientNameSnapshot) throw new Error('Nome do paciente é obrigatório no registro mensal');

        const record = await this.repository.saveMonthlyRecord({
            ...data,
            patientNameSnapshot
        });

        // Se o faturamento mensal mudou o valor, atualiza o valor padrão do cadastro do paciente
        if (data.patientId && data.sessionPriceCents !== undefined) {
            const patient = await this.repository.findPatientById(data.tenantId, data.patientId);
            if (patient && patient.defaultSessionPriceCents !== data.sessionPriceCents) {
                await this.repository.savePatient({
                    ...patient,
                    defaultSessionPriceCents: data.sessionPriceCents
                });
            }
        }

        return record;
    }
}
