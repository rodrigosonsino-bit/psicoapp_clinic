import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository, SaveExpenseDTO } from '../../domain/repositories/IPsychotherapyRepository';
import { PsychotherapyExpense } from '../../domain/models/PsychotherapyExpense';
import { AppError } from '../../domain/errors/AppError';

@injectable()
export class SavePsychotherapyExpenseUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async execute(data: SaveExpenseDTO): Promise<PsychotherapyExpense> {
        if (!data.tenantId || !data.date || !data.amountCents || !data.description || !data.category) {
            throw new AppError('Preencha todos os campos obrigatórios da despesa.', 400);
        }

        return this.repository.saveExpense({
            ...data,
            date: new Date(data.date)
        });
    }
}
