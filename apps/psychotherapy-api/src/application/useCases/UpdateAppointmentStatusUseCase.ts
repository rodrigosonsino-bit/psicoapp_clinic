import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';
import { GoogleCalendarService } from '../../infrastructure/google/GoogleCalendarService';
import { PsychotherapyAppointment, AppointmentStatus } from '../../domain/models/PsychotherapyAppointment';
import { PASTORAL_SENTINEL_EMAIL } from '../../domain/constants/pastoral';
import { logger } from '../../infrastructure/logger';

const APP_BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:3000';

/**
 * Atualiza o status de um agendamento (ex.: Realizada, Faltou, Cancelado,
 * Confirmado) e empurra a mudança para o Google Calendar — o app é a
 * referência, então o evento espelhado também precisa refletir o status.
 */
@injectable()
export class UpdateAppointmentStatusUseCase {
    constructor(
        @inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository,
        @inject('GoogleCalendarService') private readonly googleCalendar: GoogleCalendarService
    ) {}

    async execute(tenantId: string, id: string, status: AppointmentStatus): Promise<PsychotherapyAppointment> {
        const appointment = await this.repository.updateAppointmentStatus(tenantId, id, status);

        this.syncWithGoogleCalendar(appointment, tenantId).catch(err => {
            logger.error({ err, appointmentId: appointment.id }, 'Falha no sync Google Calendar após atualização de status (background)');
        });

        return appointment;
    }

    private async syncWithGoogleCalendar(appointment: PsychotherapyAppointment, tenantId: string): Promise<void> {
        const patient = await this.repository.findPatientById(tenantId, appointment.patientId);
        if (!patient) return;

        const confirmUrl = `${APP_BASE_URL}/confirm/${appointment.confirmToken}`;
        const isPastoral = patient.email === PASTORAL_SENTINEL_EMAIL;
        await this.googleCalendar.syncAppointment(tenantId, appointment, patient.name, patient.phone, confirmUrl, isPastoral);
    }
}
