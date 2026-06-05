export type PatientStatus = 'weekly' | 'biweekly' | 'one_off' | 'inactive';
export type PaymentType = 'monthly' | 'per_session';

export class PsychotherapyPatient {
    constructor(
        public readonly id: string,
        public readonly tenantId: string,
        public readonly name: string,
        public readonly status: PatientStatus,
        public readonly paymentType: PaymentType | null,
        public readonly defaultSessionPriceCents: number | null,
        public readonly notes: string | null,
        public readonly document: string | null,
        public readonly phone: string | null,
        public readonly email: string | null,
        public readonly createdAt: Date,
        public readonly updatedAt: Date
    ) {}
}
