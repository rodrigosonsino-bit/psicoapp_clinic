import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';
import { AppError } from '../../domain/errors/AppError';

@injectable()
export class DeletePsychotherapyExpenseUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async execute(tenantId: string, id: string): Promise<void> {
        if (!tenantId || !id) {
            throw new AppError('TenantId e ID da despesa são obrigatórios.', 400);
        }

        await this.repository.deleteExpense(tenantId, id);
    }
}
