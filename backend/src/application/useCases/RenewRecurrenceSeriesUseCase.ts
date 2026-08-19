import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';
import { SavePsychotherapyAppointmentUseCase } from './SavePsychotherapyAppointmentUseCase';
import { PsychotherapyAppointment } from '../../domain/models/PsychotherapyAppointment';
import { AppError } from '../../domain/errors/AppError';

@injectable()
export class RenewRecurrenceSeriesUseCase {
    constructor(
        @inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository,
        private readonly saveAppointmentUseCase: SavePsychotherapyAppointmentUseCase
    ) {}

    async execute(tenantId: string, appointmentId: string, additionalMonths: number): Promise<PsychotherapyAppointment> {
        if (![1, 2, 3].includes(additionalMonths)) {
            throw new AppError('Renovação deve ser de 1, 2 ou 3 meses', 400);
        }

        const renewed = await this.saveAppointmentUseCase.renewSeries(tenantId, appointmentId, additionalMonths);
        await this.repository.resolveRecurrenceRenewalNotice(tenantId, appointmentId, 'renewed');
        return renewed;
    }
}
