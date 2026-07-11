export type PixChargeStatus = 'pending' | 'paid' | 'expired' | 'canceled';

export class PixCharge {
    constructor(
        public readonly id: string,
        public readonly tenantId: string,
        public readonly patientId: string,
        public readonly monthlyRecordId: string | null,
        public readonly amountCents: number,
        public readonly description: string,
        public readonly status: PixChargeStatus,
        public readonly providerChargeId: string | null,
        public readonly providerTxid: string | null,
        public readonly qrCode: string | null,
        public readonly qrCodeImageUrl: string | null,
        public readonly expiresAt: Date | null,
        public readonly paidAt: Date | null,
        public readonly createdAt: Date,
        public readonly updatedAt: Date
    ) {}
}
