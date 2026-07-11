import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';
import { PsychotherapyMonthlyRecord } from '../../domain/models/PsychotherapyMonthlyRecord';
import { AppError } from '../../domain/errors/AppError';

export interface AddAdvanceCreditInput {
    tenantId: string;
    patientId: string;
    targetMonth: string;
    amountCents: number;
}

/**
 * Crédito adiantado: paciente paga por sessão(ões) de um mês que ainda não foi gerado
 * (ex.: paga as 4 do mês corrente + adianta 1 do mês seguinte). Soma no
 * previous_month_paid_cents do mês-alvo, criando o registro se necessário — sem exigir
 * que o mês já tenha sido gerado via "Gerar Mês".
 */
@injectable()
export class AddAdvanceCreditUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async execute(input: AddAdvanceCreditInput): Promise<PsychotherapyMonthlyRecord> {
        const { tenantId, patientId, targetMonth, amountCents } = input;

        if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
            throw new AppError('Mês inválido. Use o formato YYYY-MM', 400);
        }
        if (!amountCents || amountCents <= 0) {
            throw new AppError('O valor adiantado deve ser maior que zero.', 400);
        }

        const patient = await this.repository.findPatientById(tenantId, patientId);
        if (!patient) {
            throw new AppError('Paciente não encontrado.', 404);
        }

        return this.repository.addAdvanceCredit({
            tenantId,
            patientId,
            targetMonth,
            amountCents,
            patientNameSnapshot: patient.name,
            status: patient.status,
            paymentType: patient.paymentType,
            sessionPriceCents: patient.defaultSessionPriceCents
        });
    }
}
