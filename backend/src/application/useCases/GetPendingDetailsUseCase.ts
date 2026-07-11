import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository, PendingDetails } from '../../domain/repositories/IPsychotherapyRepository';
import { AppError } from '../../domain/errors/AppError';

@injectable()
export class GetPendingDetailsUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async execute(tenantId: string, monthStr?: string): Promise<PendingDetails> {
        if (!tenantId) {
            throw new AppError('TenantId é obrigatório.', 400);
        }

        let targetMonth = monthStr;
        if (!targetMonth) {
            const now = new Date();
            targetMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        }

        return this.repository.getPendingDetails(tenantId, targetMonth);
    }
}
