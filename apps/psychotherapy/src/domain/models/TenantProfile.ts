export class TenantProfile {
    constructor(
        public readonly id: string,
        public readonly name: string,
        public readonly email: string,
        public readonly fullName: string | null,
        public readonly document: string | null,
        public readonly professionalId: string | null,
        public readonly address: string | null,
        public readonly twoFactorEnabled: boolean = false
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
            twoFactorEnabled: this.twoFactorEnabled
        };
    }
}
