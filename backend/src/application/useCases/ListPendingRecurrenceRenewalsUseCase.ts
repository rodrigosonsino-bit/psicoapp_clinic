import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository, RecurrenceRenewalNotice } from '../../domain/repositories/IPsychotherapyRepository';

@injectable()
export class ListPendingRecurrenceRenewalsUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async execute(tenantId: string): Promise<RecurrenceRenewalNotice[]> {
        return this.repository.listPendingRecurrenceRenewals(tenantId);
    }
}
