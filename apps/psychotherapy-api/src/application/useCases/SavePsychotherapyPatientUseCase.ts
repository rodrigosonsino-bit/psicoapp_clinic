import { injectable, inject } from 'tsyringe';
import { PsychotherapyPatient } from '../../domain/models/PsychotherapyPatient';
import { IPsychotherapyRepository, SavePatientDTO } from '../../domain/repositories/IPsychotherapyRepository';
import { AppError } from '../../domain/errors/AppError';

function getCurrentMonthStr(): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
    }).formatToParts(new Date());
    const y = parts.find(p => p.type === 'year')!.value;
    const m = parts.find(p => p.type === 'month')!.value;
    return `${y}-${m}`;
}

@injectable()
export class SavePsychotherapyPatientUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async execute(data: SavePatientDTO): Promise<PsychotherapyPatient> {
        const name = data.name.trim();
        if (!name) throw new AppError('Nome do paciente é obrigatório');

        if (data.document && data.document.length < 11) {
            throw new AppError('CPF/CNPJ inválido. Deve ter no mínimo 11 caracteres.', 400);
        }

        const patient = await this.repository.savePatient({
            ...data,
            name
        });

        // Se o paciente foi atualizado (já possuía id) e o valor padrão mudou,
        // atualiza também o faturamento mensal do mês corrente se ele existir
        if (data.id && data.defaultSessionPriceCents !== undefined) {
            const currentMonth = getCurrentMonthStr();
            const records = await this.repository.listMonthlyRecords(data.tenantId, currentMonth);
            const patientRecord = records.find(r => r.patientId === data.id);
            if (patientRecord && patientRecord.sessionPriceCents !== data.defaultSessionPriceCents) {
                await this.repository.saveMonthlyRecord({
                    ...patientRecord,
                    sessionPriceCents: data.defaultSessionPriceCents
                });
            }
        }

        return patient;
    }
}
