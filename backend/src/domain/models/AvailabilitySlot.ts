export type AvailabilityRecurrenceType = 'weekly' | 'biweekly' | 'once';
export type AvailabilityModality = 'presencial' | 'online' | 'both';

export class AvailabilitySlot {
    constructor(
        public readonly id: string,
        public readonly tenantId: string,
        public readonly dayOfWeek: number,   // 0=Dom…6=Sáb
        public readonly startTime: string,   // "HH:MM"
        public readonly durationMinutes: number,
        public readonly isActive: boolean,
        public readonly notes: string | null,
        public readonly createdAt: Date,
        public readonly updatedAt: Date,
        public readonly recurrenceType: AvailabilityRecurrenceType = 'weekly',
        public readonly startDate: Date | null = null,
        public readonly modality: AvailabilityModality = 'presencial'
    ) {}
}
