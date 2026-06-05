export type SessionStatus = 'attended' | 'justified_absence' | 'unjustified_absence' | 'canceled';

export interface PsychotherapySession {
    id: string;
    tenantId: string;
    patientId: string;
    date: Date;
    status: SessionStatus;
    notes?: string;
    createdAt?: Date;
    updatedAt?: Date;
}
