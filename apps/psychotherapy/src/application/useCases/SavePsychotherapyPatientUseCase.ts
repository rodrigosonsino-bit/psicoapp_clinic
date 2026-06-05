import { injectable, inject } from 'tsyringe';
import { PsychotherapyPatient } from '../../domain/models/PsychotherapyPatient';
import { IPsychotherapyRepository, SavePatientDTO } from '../../domain/repositories/IPsychotherapyRepository';
import { AppError } from '../../domain/errors/AppError';

@injectable()
export class SavePsychotherapyPatientUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async execute(data: SavePatientDTO): Promise<PsychotherapyPatient> {
        const name = data.name.trim();
        if (!name) throw new AppError('Nome do paciente é obrigatório');

        if (data.document && data.document.length < 11) {
            throw new AppError('CPF/CNPJ inválido. Deve ter no mínimo 11 caracteres.', 400);
        }

        return this.repository.savePatient({
            ...data,
            name
        });
    }
}
