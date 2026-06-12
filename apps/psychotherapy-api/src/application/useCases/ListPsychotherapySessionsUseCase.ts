import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository, PaginatedResult } from '../../domain/repositories/IPsychotherapyRepository';
import { PsychotherapySession } from '../../domain/models/PsychotherapySession';
import { AppError } from '../../domain/errors/AppError';

@injectable()
export class ListPsychotherapySessionsUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async execute(
        tenantId: string,
        patientId?: string,
        start?: Date,
        end?: Date,
        page = 1,
        limit = 20
    ): Promise<PaginatedResult<PsychotherapySession>> {
        if (!tenantId) {
            throw new AppError('TenantId é obrigatório para listar sessões.', 400);
        }

        return this.repository.listSessions(
            tenantId,
            patientId,
            start ? new Date(start) : undefined,
            end ? new Date(end) : undefined,
            { page, limit }
        );
    }
}
