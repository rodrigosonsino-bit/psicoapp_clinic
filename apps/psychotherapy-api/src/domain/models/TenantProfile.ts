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
        public readonly bookingPage: BookingPageSettings | null = null
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
            bookingPage: this.bookingPage
        };
    }
}
