export class ClinicalNote {
    constructor(
        public readonly id: string,
        public readonly tenantId: string,
        public readonly patientId: string,
        public readonly sessionId: string | null,
        public readonly noteDate: Date,
        public readonly content: string,
        public readonly tags: string[],
        public readonly createdAt: Date,
        public readonly updatedAt: Date
    ) {}
}
