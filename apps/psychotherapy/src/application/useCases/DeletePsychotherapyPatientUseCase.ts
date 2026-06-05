import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';
import { AppError } from '../../domain/errors/AppError';

@injectable()
export class DeletePsychotherapyPatientUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async execute(tenantId: string, id: string): Promise<void> {
        if (!id) throw new AppError('ID do paciente é obrigatório');
        return this.repository.deletePatient(tenantId, id);
    }
}
