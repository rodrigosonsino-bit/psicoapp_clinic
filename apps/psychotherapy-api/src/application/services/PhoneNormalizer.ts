/**
 * Normaliza telefones de pacientes para o formato canônico usado pelo WhatsApp
 * (DDI + DDD + número, somente dígitos). Não tenta "adivinhar" números ambíguos —
 * rejeita (retorna null) em vez de corrigir silenciosamente.
 */
export class PhoneNormalizer {
    constructor(private readonly defaultCountryCode: string = process.env.PHONE_DEFAULT_COUNTRY_CODE || '55') {}

    public normalize(rawPhone: string | null | undefined): string | null {
        if (!rawPhone) return null;

        const digits = rawPhone.replace(/\D/g, '');
        if (!digits) return null;

        // Já vem com DDI (12-13 dígitos: DDI + DDD + 8/9 dígitos)
        if (digits.length === 12 || digits.length === 13) {
            return digits;
        }

        // Sem DDI (10-11 dígitos: DDD + 8/9 dígitos) — aplica o DDI padrão
        if (digits.length === 10 || digits.length === 11) {
            return this.defaultCountryCode + digits;
        }

        // Comprimento inválido — não tenta corrigir
        return null;
    }
}
