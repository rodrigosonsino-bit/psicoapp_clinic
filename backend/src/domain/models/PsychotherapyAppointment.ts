export type AppointmentStatus = 'scheduled' | 'confirmed' | 'attended' | 'canceled' | 'no_show';
export type RecurrenceType = 'none' | 'weekly' | 'biweekly' | 'monthly';
export type GoogleSyncState = 'idle' | 'pending' | 'processing' | 'synced' | 'error' | 'deleted';

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
        public readonly updatedAt: Date = new Date(),
        public readonly groupId: string | null = null,
        public readonly googleSyncState: GoogleSyncState = 'idle',
        public readonly googleEventGeneration: number = 0,
        public readonly googleSyncAttempts: number = 0,
        public readonly googleSyncLastError: string | null = null,
        public readonly googleSyncUpdatedAt: Date | null = null,
        public readonly googleMeetLink: string | null = null,
        public readonly modality: 'online' | 'presencial' = 'online'
    ) {}
}
