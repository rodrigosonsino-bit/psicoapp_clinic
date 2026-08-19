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
    /** Copiado do agendamento vinculado (psychotherapy_appointments.google_meet_link) — a
     *  sessão em si nunca tem link próprio. undefined se não houver agendamento vinculado
     *  ou ele ainda não tiver o Meet sincronizado. */
    googleMeetLink?: string;
    createdAt?: Date;
    updatedAt?: Date;
}
