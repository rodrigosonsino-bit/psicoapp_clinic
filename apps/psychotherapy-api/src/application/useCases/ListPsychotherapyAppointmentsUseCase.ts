import { injectable, inject } from 'tsyringe';
import { PsychotherapyAppointment } from '../../domain/models/PsychotherapyAppointment';
import { IPsychotherapyRepository, PaginatedResult, ListAppointmentsOptions } from '../../domain/repositories/IPsychotherapyRepository';

@injectable()
export class ListPsychotherapyAppointmentsUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async execute(tenantId: string, options?: ListAppointmentsOptions): Promise<PaginatedResult<PsychotherapyAppointment>> {
        return this.repository.listAppointments(tenantId, options);
    }
}
