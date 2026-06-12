import { injectable, inject } from 'tsyringe';
import { BookingLink } from '../../../domain/models/BookingLink';
import { IPsychotherapyRepository } from '../../../domain/repositories/IPsychotherapyRepository';
import { NotFoundError } from '../../../domain/errors/NotFoundError';
import { AppError } from '../../../domain/errors/AppError';

const APP_BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:5173';

export interface BookingLinkResult {
    link: BookingLink;
    url: string;
}

@injectable()
export class GenerateBookingLinkUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async execute(tenantId: string, patientId: string, expiresInDays?: number): Promise<BookingLinkResult> {
        const patient = await this.repository.findPatientById(tenantId, patientId);
        if (!patient) throw new NotFoundError('Paciente não encontrado');
        if (patient.status === 'inactive') throw new AppError('Não é possível gerar link para paciente inativo', 400);

        const expiresAt = expiresInDays
            ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
            : null;

        const link = await this.repository.upsertBookingLink(tenantId, patientId, expiresAt);
        const url = `${APP_BASE_URL}/book/${link.token}`;

        return { link, url };
    }

    async deactivate(tenantId: string, patientId: string): Promise<void> {
        return this.repository.deactivateBookingLink(tenantId, patientId);
    }
}
