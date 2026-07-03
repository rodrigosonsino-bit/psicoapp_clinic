import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';
import { AppError } from '../../domain/errors/AppError';
import { NotFoundError } from '../../domain/errors/NotFoundError';
import { PsychotherapyPatient } from '../../domain/models/PsychotherapyPatient';

export interface ChangePatientModalityInput {
    tenantId: string;
    patientId: string;
    individualTherapyEnabled: boolean;
    status?: 'weekly' | 'biweekly' | 'one_off' | 'inactive';
}

@injectable()
export class ChangePatientModalityUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async execute(input: ChangePatientModalityInput): Promise<PsychotherapyPatient> {
        const patient = await this.repository.findPatientById(input.tenantId, input.patientId);
        if (!patient) {
            throw new NotFoundError('Paciente não encontrado');
        }

        if (input.individualTherapyEnabled && input.status) {
            // Ao habilitar a modalidade individual, um status válido deve ser fornecido
            // e será salvo. Se omitido, continuará com o status atual.
        } else if (input.individualTherapyEnabled && patient.status === 'inactive') {
             // Ao ativar, se o paciente for inativo, requer status ativo
             throw new AppError('Ao habilitar a terapia individual, informe um status de frequência válido (weekly, biweekly, one_off).', 400);
        }

        const updatedPatient = await this.repository.savePatient({
            id: patient.id,
            tenantId: patient.tenantId,
            name: patient.name,
            status: input.individualTherapyEnabled && input.status ? input.status : patient.status,
            paymentType: patient.paymentType,
            defaultSessionPriceCents: patient.defaultSessionPriceCents,
            notes: patient.notes,
            document: patient.document,
            phone: patient.phone,
            email: patient.email,
            reminderChannel: patient.reminderChannel,
            fullName: patient.fullName,
            individualTherapyEnabled: input.individualTherapyEnabled
        });

        return updatedPatient;
    }
}
