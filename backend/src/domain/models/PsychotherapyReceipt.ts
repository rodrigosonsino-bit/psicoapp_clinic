export class PsychotherapyReceipt {
    constructor(
        public readonly id: string,
        public readonly tenantId: string,
        public readonly patientId: string,
        public readonly receiptNumber: number,
        public readonly amountCents: number,
        public readonly issueDate: Date,
        public readonly description: string,
        public readonly createdAt: Date,
        public readonly updatedAt: Date,
        public readonly patientNameSnapshot?: string | null,
        public readonly patientDocumentSnapshot?: string | null,
        public readonly tenantNameSnapshot?: string | null,
        public readonly tenantDocumentSnapshot?: string | null,
        public readonly tenantProfessionalIdSnapshot?: string | null,
        public readonly tenantAddressSnapshot?: string | null,
        public readonly status?: 'issued' | 'cancelled'
    ) {}

    toJSON() {
        return {
            id: this.id,
            tenantId: this.tenantId,
            patientId: this.patientId,
            receiptNumber: this.receiptNumber,
            amountCents: this.amountCents,
            issueDate: this.issueDate,
            description: this.description,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            patientNameSnapshot: this.patientNameSnapshot,
            patientDocumentSnapshot: this.patientDocumentSnapshot,
            tenantNameSnapshot: this.tenantNameSnapshot,
            tenantDocumentSnapshot: this.tenantDocumentSnapshot,
            tenantProfessionalIdSnapshot: this.tenantProfessionalIdSnapshot,
            tenantAddressSnapshot: this.tenantAddressSnapshot,
            status: this.status
        };
    }
}
