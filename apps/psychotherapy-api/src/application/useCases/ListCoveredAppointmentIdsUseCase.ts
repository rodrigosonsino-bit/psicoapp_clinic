import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';
import { AppError } from '../../domain/errors/AppError';

@injectable()
export class ListCoveredAppointmentIdsUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async execute(tenantId: string, month: string): Promise<string[]> {
        if (!tenantId) {
            throw new AppError('TenantId é obrigatório.', 400);
        }
        return this.repository.listCoveredAppointmentIds(tenantId, month);
    }
}
