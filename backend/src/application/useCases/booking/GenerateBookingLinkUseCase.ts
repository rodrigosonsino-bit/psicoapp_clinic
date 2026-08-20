import { injectable, inject } from 'tsyringe';
import { BookingLink } from '../../../domain/models/BookingLink';
import { IPsychotherapyRepository } from '../../../domain/repositories/IPsychotherapyRepository';
import { NotFoundError } from '../../../domain/errors/NotFoundError';
import { AppError } from '../../../domain/errors/AppError';

const APP_BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:5173';

// Achado de pentest 2026-08-19: o frontend sempre chama esta rota com body vazio
// (Patients.tsx/PatientProfile.tsx nunca enviam expiresInDays), então todo link real
// gerado em produção fica com expiresAt=null — multi-uso e sem expiração pra sempre. Se
// vazar, um agendamento não autorizado fica possível indefinidamente. Aplica um teto
// padrão quando o chamador não pede um prazo explícito; quem quiser um link permanente
// de propósito ainda pode passar expiresInDays explicitamente maior (não há limite aqui).
const DEFAULT_EXPIRES_IN_DAYS = 90;

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

        const effectiveExpiresInDays = expiresInDays ?? DEFAULT_EXPIRES_IN_DAYS;
        const expiresAt = new Date(Date.now() + effectiveExpiresInDays * 24 * 60 * 60 * 1000);

        const link = await this.repository.upsertBookingLink(tenantId, patientId, expiresAt);
        const url = `${APP_BASE_URL}/book/${link.token}`;

        return { link, url };
    }

    async deactivate(tenantId: string, patientId: string): Promise<void> {
        return this.repository.deactivateBookingLink(tenantId, patientId);
    }
}
