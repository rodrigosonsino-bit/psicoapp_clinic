import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository, PaginatedResult } from '../../domain/repositories/IPsychotherapyRepository';
import { PsychotherapyExpense } from '../../domain/models/PsychotherapyExpense';
import { AppError } from '../../domain/errors/AppError';

@injectable()
export class ListPsychotherapyExpensesUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async execute(
        tenantId: string,
        start?: Date,
        end?: Date,
        page = 1,
        limit = 20
    ): Promise<PaginatedResult<PsychotherapyExpense>> {
        if (!tenantId) {
            throw new AppError('TenantId é obrigatório.', 400);
        }

        return this.repository.listExpenses(
            tenantId,
            start ? new Date(start) : undefined,
            end ? new Date(end) : undefined,
            { page, limit }
        );
    }
}
