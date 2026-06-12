import { injectable, inject } from 'tsyringe';
import { PsychotherapyReceipt } from '../../domain/models/PsychotherapyReceipt';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';

@injectable()
export class ListPsychotherapyReceiptsUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async execute(tenantId: string, patientId?: string): Promise<PsychotherapyReceipt[]> {
        return this.repository.listReceipts(tenantId, patientId);
    }
}
