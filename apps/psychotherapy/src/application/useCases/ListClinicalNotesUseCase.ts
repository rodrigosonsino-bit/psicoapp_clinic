import { injectable, inject } from 'tsyringe';
import { ClinicalNote } from '../../domain/models/ClinicalNote';
import { IPsychotherapyRepository, PaginatedResult } from '../../domain/repositories/IPsychotherapyRepository';

@injectable()
export class ListClinicalNotesUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async execute(tenantId: string, patientId: string, page: number, limit: number): Promise<PaginatedResult<ClinicalNote>> {
        return this.repository.listClinicalNotes(tenantId, patientId, page, limit);
    }
}
