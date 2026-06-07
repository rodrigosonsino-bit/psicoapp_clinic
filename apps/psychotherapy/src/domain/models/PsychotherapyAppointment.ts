export type AppointmentStatus = 'scheduled' | 'confirmed' | 'attended' | 'canceled' | 'no_show';
export type RecurrenceType = 'none' | 'weekly' | 'biweekly';

export class PsychotherapyAppointment {
    constructor(
        public readonly id: string,
        public readonly tenantId: string,
        public readonly patientId: string,
        public readonly scheduledAt: Date,
        public readonly durationMinutes: number,
        public readonly status: AppointmentStatus,
        public readonly recurrence: RecurrenceType,
        public readonly recurrenceEndDate: Date | null,
        public readonly notes: string | null,
        public readonly googleEventId: string | null,
        public readonly googleEventUrl: string | null,
        public readonly confirmToken: string | null,
        public readonly confirmedAt: Date | null,
        public readonly parentId: string | null = null,
        public readonly createdAt: Date = new Date(),
        public readonly updatedAt: Date = new Date()
    ) {}
}
