import { injectable, inject } from 'tsyringe';
import { TenantProfile } from '../../domain/models/TenantProfile';
import { IPsychotherapyRepository, UpdateTenantProfileDTO } from '../../domain/repositories/IPsychotherapyRepository';
import { AppError } from '../../domain/errors/AppError';

@injectable()
export class UpdateTenantProfileUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async execute(data: UpdateTenantProfileDTO): Promise<TenantProfile> {
        // Here we could add some validation to document if it is provided,
        // e.g. checking length or characters for CPF/CNPJ.
        if (data.document && data.document.length < 11) {
            throw new AppError('Documento inválido. Deve ter pelo menos 11 caracteres.', 400);
        }

        return this.repository.updateTenantProfile(data);
    }
}
