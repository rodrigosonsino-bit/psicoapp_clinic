// ── domain/models/TherapyGroup.ts ─────────────────────────────────────────────

export type GroupAttendanceStatus = 'present' | 'absent' | 'excused';

export class TherapyGroup {
    constructor(
        public readonly id: string,
        public readonly tenantId: string,
        public readonly name: string,
        public readonly description: string | null,
        public readonly sessionPriceCents: number,
        public readonly dayOfWeek: number | null,
        public readonly startTime: string | null,   // "HH:MM"
        public readonly durationMinutes: number,
        public readonly isActive: boolean,
        public readonly deletedAt: Date | null,
        public readonly createdAt: Date,
        public readonly updatedAt: Date,
        public readonly monthlyFeeCents: number | null = null,
        public readonly startDate: Date | null = null,
        public readonly durationMonths: number | null = null
    ) {}
}

export class GroupSessionRecord {
    constructor(
        public readonly id: string,
        public readonly tenantId: string,
        public readonly groupId: string,
        public readonly sessionDate: string,          // "YYYY-MM-DD"
        public readonly patientId: string,
        public readonly appointmentId: string | null,
        public readonly attendanceStatus: GroupAttendanceStatus,
        public readonly notes: string | null,
        public readonly sessionPriceCents: number | null,
        public readonly createdAt: Date,
        public readonly updatedAt: Date
    ) {}
}

/**
 * Constrói um Date com timezone explícito America/Sao_Paulo.
 * Exemplo: groupSessionDatetime("2025-06-10", "14:00") → Date correto em BRT.
 */
export function groupSessionDatetime(dateStr: string, startTime: string): Date {
    // Monta ISO 8601 com offset fixo BRT (-03:00)
    // Isso garante que o Date seja correto mesmo em servidores UTC (Docker/prod).
    return new Date(`${dateStr}T${startTime}:00-03:00`);
}
