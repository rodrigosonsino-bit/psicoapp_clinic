import { injectable, inject } from 'tsyringe';
import { PsychotherapyAppointment } from '../../domain/models/PsychotherapyAppointment';
import { IPsychotherapyRepository, SaveAppointmentDTO } from '../../domain/repositories/IPsychotherapyRepository';
import { GoogleCalendarService } from '../../infrastructure/google/GoogleCalendarService';
import { AppError } from '../../domain/errors/AppError';
import { logger } from '../../infrastructure/logger';

const APP_BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:3000';

@injectable()
export class SavePsychotherapyAppointmentUseCase {
    constructor(
        @inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository,
        @inject('GoogleCalendarService') private readonly googleCalendar: GoogleCalendarService
    ) {}

    async execute(data: SaveAppointmentDTO): Promise<PsychotherapyAppointment> {
        if (data.scheduledAt <= new Date(Date.now() - 60_000) && !data.id) {
            throw new AppError('Não é possível agendar sessões no passado', 400);
        }
        if (data.recurrence !== 'none' && data.recurrence && !data.recurrenceEndDate) {
            throw new AppError('Data de término da recorrência é obrigatória para agendamentos recorrentes', 400);
        }
        if (data.recurrenceEndDate && data.recurrenceEndDate <= data.scheduledAt) {
            throw new AppError('Data de término da recorrência deve ser posterior à data do agendamento', 400);
        }
        if (data.durationMinutes !== undefined && (data.durationMinutes < 10 || data.durationMinutes > 240)) {
            throw new AppError('Duração da sessão deve estar entre 10 e 240 minutos', 400);
        }

        const appointment = await this.repository.saveAppointment(data);

        // Sync com Google Calendar de forma assíncrona (não bloqueia a resposta)
        this.syncWithGoogleCalendar(appointment, data.tenantId).catch(err => {
            logger.error({ err, appointmentId: appointment.id }, 'Falha no sync Google Calendar (background)');
        });

        return appointment;
    }

    private async syncWithGoogleCalendar(
        appointment: PsychotherapyAppointment,
        tenantId: string
    ): Promise<void> {
        const patient = await this.repository.findPatientById(tenantId, appointment.patientId);
        if (!patient) return;

        const confirmUrl = `${APP_BASE_URL}/confirm/${appointment.confirmToken}`;
        await this.googleCalendar.syncAppointment(
            tenantId,
            appointment,
            patient.name,
            patient.phone,
            confirmUrl
        );
    }
}
