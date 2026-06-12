export class BookingLink {
    constructor(
        public readonly id: string,
        public readonly token: string,
        public readonly tenantId: string,
        public readonly patientId: string,
        public readonly expiresAt: Date | null,
        public readonly isActive: boolean,
        public readonly createdAt: Date,
        public readonly updatedAt: Date
    ) {}

    get isExpired(): boolean {
        return this.expiresAt !== null && this.expiresAt < new Date();
    }
}
