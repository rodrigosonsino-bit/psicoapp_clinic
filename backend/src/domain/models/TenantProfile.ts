/**
 * Personalização da página pública de agendamento (por tenant).
 * Todos os campos são opcionais; quando ausentes, a página usa os padrões.
 */
export interface BookingPageSettings {
    professionLabel?: string | null; // ex.: "Psicoterapeuta"
    displayName?: string | null;     // nome de exibição / consultório (sobrepõe o nome)
    accentColor?: string | null;     // cor de destaque em hex "#rrggbb"
    welcomeMessage?: string | null;  // mensagem de boas-vindas / mini-bio
}

/** Taxa de cartão sugerida por nº de parcelas (chave "1"-"12"), em basis points (350 = 3,50%). */
export type CardFeeRates = Record<string, number>;

export class TenantProfile {
    constructor(
        public readonly id: string,
        public readonly name: string,
        public readonly email: string,
        public readonly fullName: string | null,
        public readonly document: string | null,
        public readonly professionalId: string | null,
        public readonly address: string | null,
        public readonly twoFactorEnabled: boolean = false,
        public readonly bookingPage: BookingPageSettings | null = null,
        public readonly whatsappReminderTemplate: string | null = null,
        public readonly cardFeeRates: CardFeeRates | null = null
    ) {}

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            email: this.email,
            fullName: this.fullName,
            document: this.document,
            professionalId: this.professionalId,
            address: this.address,
            twoFactorEnabled: this.twoFactorEnabled,
            bookingPage: this.bookingPage,
            whatsappReminderTemplate: this.whatsappReminderTemplate,
            cardFeeRates: this.cardFeeRates
        };
    }
}
