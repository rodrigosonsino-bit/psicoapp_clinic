import { injectable, inject } from 'tsyringe';
import { TenantProfile, BookingPageSettings } from '../../domain/models/TenantProfile';
import { IPsychotherapyRepository, UpdateTenantProfileDTO } from '../../domain/repositories/IPsychotherapyRepository';
import { AppError } from '../../domain/errors/AppError';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Normaliza string: trim, limita tamanho; vazio vira null. */
function cleanText(value: unknown, maxLen: number): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim().slice(0, maxLen);
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * Sanitiza as configurações da página de agendamento antes de persistir.
 * A cor é validada estritamente (hex) pois é aplicada como CSS no frontend.
 */
function sanitizeBookingPage(input: unknown): BookingPageSettings {
    const raw = (input ?? {}) as Record<string, unknown>;
    const accent = typeof raw.accentColor === 'string' ? raw.accentColor.trim() : '';
    return {
        professionLabel: cleanText(raw.professionLabel, 40),
        displayName: cleanText(raw.displayName, 60),
        accentColor: HEX_COLOR.test(accent) ? accent : null,
        welcomeMessage: cleanText(raw.welcomeMessage, 280)
    };
}

@injectable()
export class UpdateTenantProfileUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async execute(data: UpdateTenantProfileDTO): Promise<TenantProfile> {
        // Here we could add some validation to document if it is provided,
        // e.g. checking length or characters for CPF/CNPJ.
        if (data.document && data.document.length < 11) {
            throw new AppError('Documento inválido. Deve ter pelo menos 11 caracteres.', 400);
        }

        // bookingPage só é tocado quando enviado; sanitiza para evitar conteúdo inválido.
        const sanitized: UpdateTenantProfileDTO = {
            ...data,
            bookingPage: data.bookingPage !== undefined && data.bookingPage !== null
                ? sanitizeBookingPage(data.bookingPage)
                : undefined
        };

        return this.repository.updateTenantProfile(sanitized);
    }
}
