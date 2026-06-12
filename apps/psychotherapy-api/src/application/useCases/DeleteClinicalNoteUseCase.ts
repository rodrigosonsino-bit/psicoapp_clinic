import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';

@injectable()
export class DeleteClinicalNoteUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async execute(tenantId: string, id: string): Promise<void> {
        return this.repository.deleteClinicalNote(tenantId, id);
    }
}
