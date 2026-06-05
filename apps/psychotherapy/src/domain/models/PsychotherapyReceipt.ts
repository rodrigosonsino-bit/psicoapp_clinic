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
        public readonly updatedAt: Date
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
            updatedAt: this.updatedAt
        };
    }
}
