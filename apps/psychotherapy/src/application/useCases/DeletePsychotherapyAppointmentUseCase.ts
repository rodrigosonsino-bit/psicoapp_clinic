import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';
import { GoogleCalendarService } from '../../infrastructure/google/GoogleCalendarService';
import { logger } from '../../infrastructure/logger';

@injectable()
export class DeletePsychotherapyAppointmentUseCase {
    constructor(
        @inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository,
        @inject('GoogleCalendarService') private readonly googleCalendar: GoogleCalendarService
    ) {}

    async execute(tenantId: string, id: string): Promise<void> {
        const appointment = await this.repository.findAppointmentById(tenantId, id);

        await this.repository.deleteAppointment(tenantId, id);

        if (appointment?.googleEventId) {
            this.googleCalendar.deleteEvent(tenantId, appointment.googleEventId).catch(err => {
                logger.warn({ err, appointmentId: id }, 'Falha ao remover evento do Google Calendar');
            });
        }
    }
}
