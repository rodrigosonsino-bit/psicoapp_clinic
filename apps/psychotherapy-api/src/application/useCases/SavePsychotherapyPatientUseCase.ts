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

        // Se o paciente foi atualizado (já possuía id), reflete no faturamento mensal do
        // mês corrente (se o registro já existir): preço padrão e status. O status precisa
        // ser sincronizado aqui porque a tela de Faturamento Mensal esconde registros com
        // status 'inactive' — sem isso, reativar um paciente só o faria reaparecer na
        // próxima mudança de status de agendamento (ou no próximo "Gerar Mês").
        if (data.id) {
            const currentMonth = getCurrentMonthStr();
            const records = await this.repository.listMonthlyRecords(data.tenantId, currentMonth);
            const patientRecord = records.find(r => r.patientId === data.id);
            if (patientRecord) {
                const needsPriceUpdate = data.defaultSessionPriceCents !== undefined
                    && patientRecord.sessionPriceCents !== data.defaultSessionPriceCents;
                const needsStatusUpdate = patientRecord.status !== data.status;

                if (needsPriceUpdate || needsStatusUpdate) {
                    await this.repository.saveMonthlyRecord({
                        ...patientRecord,
                        ...(needsPriceUpdate ? { sessionPriceCents: data.defaultSessionPriceCents } : {}),
                        ...(needsStatusUpdate ? { status: data.status } : {})
                    });
                }
            }
        }

        return patient;
    }
}
