import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';
import { GoogleCalendarService } from '../../infrastructure/google/GoogleCalendarService';
import { AppError } from '../../domain/errors/AppError';
import { logger } from '../../infrastructure/logger';

@injectable()
export class DeletePsychotherapyPatientUseCase {
    constructor(
        @inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository,
        @inject('GoogleCalendarService') private readonly googleCalendar: GoogleCalendarService
    ) {}

    async execute(tenantId: string, id: string): Promise<void> {
        if (!id) throw new AppError('ID do paciente é obrigatório');

        // Buscar agendamentos futuros com evento vinculado no Google Calendar
        // antes do DELETE CASCADE apagar os google_event_ids
        const { data: appointments } = await this.repository.listAppointments(tenantId, {
            patientId: id,
            start: new Date()
        });

        // Remover eventos futuros do Google Calendar para evitar reimportação
        // pelo ciclo de sincronização (SyncGoogleCalendarEventsUseCase)
        for (const appt of appointments) {
            if (appt.googleEventId) {
                try {
                    await this.googleCalendar.deleteEvent(tenantId, appt.googleEventId);
                } catch (err) {
                    logger.warn({ err, appointmentId: appt.id, eventId: appt.googleEventId },
                        'Falha ao remover evento do Google Calendar durante exclusão de paciente. Continuando.'
                    );
                }
            }
        }

        return this.repository.deletePatient(tenantId, id);
    }
}
