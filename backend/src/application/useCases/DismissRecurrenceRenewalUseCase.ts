import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';

@injectable()
export class DismissRecurrenceRenewalUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async execute(tenantId: string, appointmentId: string): Promise<void> {
        await this.repository.resolveRecurrenceRenewalNotice(tenantId, appointmentId, 'dismissed');
    }
}
