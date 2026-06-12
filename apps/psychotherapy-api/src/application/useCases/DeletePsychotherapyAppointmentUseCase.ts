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

    async execute(tenantId: string, id: string, mode: 'single' | 'future' | 'all' = 'single'): Promise<void> {
        const appointment = await this.repository.findAppointmentById(tenantId, id);
        if (!appointment) return;

        if (mode === 'single') {
            await this.repository.deleteAppointment(tenantId, id);
            if (appointment.googleEventId) {
                this.googleCalendar.deleteEvent(tenantId, appointment.googleEventId).catch(err => {
                    logger.warn({ err, appointmentId: id }, 'Falha ao remover evento do Google Calendar');
                });
            }
            return;
        }

        const rootId = appointment.parentId ?? appointment.id;
        const series = await this.repository.listSeriesAppointments(tenantId, rootId);

        let targets = series;
        if (mode === 'future') {
            targets = series.filter(a => a.scheduledAt >= appointment.scheduledAt);
        }

        const sortedTargets = [...targets].sort((a, b) => {
            if (a.parentId && !b.parentId) return -1;
            if (!a.parentId && b.parentId) return 1;
            return 0;
        });

        for (const target of sortedTargets) {
            await this.repository.deleteAppointment(tenantId, target.id);
            if (target.googleEventId) {
                this.googleCalendar.deleteEvent(tenantId, target.googleEventId).catch(err => {
                    logger.warn({ err, appointmentId: target.id }, 'Falha ao remover evento do Google Calendar');
                });
            }
        }
    }
}
