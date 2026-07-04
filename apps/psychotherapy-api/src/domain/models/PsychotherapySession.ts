export type SessionStatus = 'attended' | 'justified_absence' | 'unjustified_absence' | 'canceled';

export interface PsychotherapySession {
    id: string;
    tenantId: string;
    patientId: string;
    date: Date;
    status: SessionStatus;
    notes?: string;
    /** Agendamento de origem (migration 082) — null se a sessão foi criada manualmente pelo
     *  Diário de Sessões, sem passar por um agendamento. */
    appointmentId?: string;
    createdAt?: Date;
    updatedAt?: Date;
}
