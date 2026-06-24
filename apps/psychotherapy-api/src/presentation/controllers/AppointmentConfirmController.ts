import { Request, Response } from 'express';
import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';
import { GoogleCalendarService } from '../../infrastructure/google/GoogleCalendarService';
import { PsychotherapyAppointment } from '../../domain/models/PsychotherapyAppointment';
import { PASTORAL_SENTINEL_EMAIL } from '../../domain/constants/pastoral';
import { logger } from '../../infrastructure/logger';

const APP_BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:3000';

@injectable()
export class AppointmentConfirmController {
    constructor(
        @inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository,
        @inject('GoogleCalendarService') private readonly googleCalendar: GoogleCalendarService
    ) {}

    /** GET /appointments/confirm/:token — retorna detalhes do agendamento para o paciente */
    async getByToken(req: Request, res: Response): Promise<Response> {
        const { token } = req.params;
        const appointment = await this.repository.findAppointmentByConfirmToken(token);

        if (!appointment) {
            return res.status(404).json({ error: 'Link de confirmação inválido ou expirado.' });
        }

        if (['canceled', 'no_show', 'attended'].includes(appointment.status)) {
            return res.status(200).json({
                data: {
                    status: appointment.status,
                    scheduledAt: appointment.scheduledAt,
                    durationMinutes: appointment.durationMinutes,
                    alreadyProcessed: true
                }
            });
        }

        return res.status(200).json({
            data: {
                id: appointment.id,
                scheduledAt: appointment.scheduledAt,
                durationMinutes: appointment.durationMinutes,
                status: appointment.status,
                confirmedAt: appointment.confirmedAt,
                alreadyProcessed: false
            }
        });
    }

    /** POST /appointments/confirm/:token — paciente confirma presença */
    async confirm(req: Request, res: Response): Promise<Response> {
        const { token } = req.params;
        const updated = await this.repository.confirmAppointmentByToken(token);

        if (!updated) {
            return res.status(409).json({ error: 'Agendamento não encontrado ou já processado.' });
        }

        this.syncWithGoogleCalendar(updated).catch(err => {
            logger.error({ err, appointmentId: updated.id }, 'Falha no sync Google Calendar após confirmação de presença (background)');
        });

        return res.status(200).json({
            data: { status: updated.status, confirmedAt: updated.confirmedAt },
            message: 'Presença confirmada com sucesso!'
        });
    }

    private async syncWithGoogleCalendar(appointment: PsychotherapyAppointment): Promise<void> {
        const patient = await this.repository.findPatientById(appointment.tenantId, appointment.patientId);
        if (!patient) return;

        const confirmUrl = `${APP_BASE_URL}/confirm/${appointment.confirmToken}`;
        const isPastoral = patient.email === PASTORAL_SENTINEL_EMAIL;
        await this.googleCalendar.syncAppointment(appointment.tenantId, appointment, patient.name, patient.phone, confirmUrl, isPastoral);
    }
}
