import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository, SaveSessionDTO } from '../../domain/repositories/IPsychotherapyRepository';
import { PsychotherapySession } from '../../domain/models/PsychotherapySession';
import { AppError } from '../../domain/errors/AppError';
import { NotFoundError } from '../../domain/errors/NotFoundError';

@injectable()
export class SavePsychotherapySessionUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async execute(data: SaveSessionDTO): Promise<PsychotherapySession> {
        if (!data.tenantId || !data.patientId || !data.date || !data.status) {
            throw new AppError('TenantId, PatientId, Data e Status são obrigatórios para registrar sessão.', 400);
        }

        // Verifica se o paciente existe
        const patient = await this.repository.findPatientById(data.tenantId, data.patientId);
        if (!patient) {
            throw new NotFoundError('Paciente não encontrado para registrar sessão.');
        }

        return this.repository.saveSession({
            ...data,
            date: new Date(data.date)
        });
    }
}
