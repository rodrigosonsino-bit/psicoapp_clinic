export class PsychotherapyFixedExpense {
    constructor(
        public readonly id: string,
        public readonly tenantId: string,
        public readonly description: string,
        public readonly amountCents: number,
        public readonly dayOfMonth: number,
        public readonly category: string | null,
        public readonly startDate: string,   // 'YYYY-MM-DD'
        public readonly endDate: string | null,
        public readonly active: boolean,
        public readonly createdAt: Date,
        public readonly updatedAt: Date
    ) {}

    toJSON() {
        return {
            id: this.id,
            tenantId: this.tenantId,
            description: this.description,
            amountCents: this.amountCents,
            dayOfMonth: this.dayOfMonth,
            category: this.category,
            startDate: this.startDate,
            endDate: this.endDate,
            active: this.active,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }
}
