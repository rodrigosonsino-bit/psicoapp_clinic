import { PatientStatus, PaymentType } from './PsychotherapyPatient';

export type PaymentStatus = 'paid' | 'pending' | 'partial';

export class PsychotherapyMonthlyRecord {
    constructor(
        public readonly id: string,
        public readonly tenantId: string,
        public readonly patientId: string | null,
        public readonly month: string,
        public readonly patientNameSnapshot: string,
        public readonly status: PatientStatus,
        public readonly paymentType: PaymentType | null,
        public readonly sessionPriceCents: number | null,
        public readonly expectedSessions: number,
        public readonly paidSessions: number,
        public readonly absences: number,
        public readonly paymentStatus: PaymentStatus,
        public readonly notes: string | null,
        public readonly previousMonthPaidCents: number,
        public readonly createdAt: Date,
        public readonly updatedAt: Date
    ) {}

    get expectedAmountCents(): number {
        if (!this.sessionPriceCents) return 0;
        if (this.paymentType === 'monthly') return this.sessionPriceCents;
        return this.sessionPriceCents * Math.max(this.expectedSessions - this.absences, 0);
    }

    get receivedAmountCents(): number {
        if (!this.sessionPriceCents) return 0;
        if (this.paymentType === 'monthly') {
            const target = Math.max(1, this.expectedSessions - this.absences);
            const paid = Math.min(this.paidSessions, target);
            return Math.round(this.sessionPriceCents * paid / target) + this.previousMonthPaidCents;
        }
        return this.sessionPriceCents * this.paidSessions + this.previousMonthPaidCents;
    }

    get pendingAmountCents(): number {
        return Math.max(this.expectedAmountCents - this.receivedAmountCents, 0);
    }

    toJSON() {
        return {
            id: this.id,
            tenantId: this.tenantId,
            patientId: this.patientId,
            month: this.month,
            patientNameSnapshot: this.patientNameSnapshot,
            status: this.status,
            paymentType: this.paymentType,
            sessionPriceCents: this.sessionPriceCents,
            expectedSessions: this.expectedSessions,
            paidSessions: this.paidSessions,
            absences: this.absences,
            paymentStatus: this.paymentStatus,
            notes: this.notes,
            previousMonthPaidCents: this.previousMonthPaidCents,
            expectedAmountCents: this.expectedAmountCents,
            receivedAmountCents: this.receivedAmountCents,
            pendingAmountCents: this.pendingAmountCents,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }
}
