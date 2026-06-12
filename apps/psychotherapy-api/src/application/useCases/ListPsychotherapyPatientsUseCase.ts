import { PsychotherapyPatient } from '../../domain/models/PsychotherapyPatient';
import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository, PaginatedResult } from '../../domain/repositories/IPsychotherapyRepository';

@injectable()
export class ListPsychotherapyPatientsUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async execute(tenantId: string, page: number, limit: number, search?: string): Promise<PaginatedResult<PsychotherapyPatient>> {
        return this.repository.listPatients(tenantId, { page, limit, search });
    }
}
