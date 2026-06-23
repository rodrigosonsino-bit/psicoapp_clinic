import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository } from '../../../domain/repositories/IPsychotherapyRepository';
import { PsychotherapyAppointment } from '../../../domain/models/PsychotherapyAppointment';
import { GoogleCalendarService } from '../../../infrastructure/google/GoogleCalendarService';
import { AppError } from '../../../domain/errors/AppError';
import { logger } from '../../../infrastructure/logger';

const APP_BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:5173';

@injectable()
export class SelfBookAppointmentUseCase {
    constructor(
        @inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository,
        @inject('GoogleCalendarService') private readonly googleCalendar: GoogleCalendarService
    ) {}

    async execute(token: string, name: string, phone: string, scheduledAtISO: string): Promise<PsychotherapyAppointment> {
        const tenantId = await this.repository.findPublicBookingToken(token);
        if (!tenantId) throw new AppError('Link de agendamento inválido.', 404);

        const scheduledAt = new Date(scheduledAtISO);
        if (isNaN(scheduledAt.getTime())) throw new AppError('Data/hora inválida.', 400);
        if (scheduledAt <= new Date()) throw new AppError('Não é possível agendar no passado.', 400);

        const conflict = await this.repository.listActiveAppointmentDatetimes(
            tenantId,
            new Date(scheduledAt.getTime() - 60_000),
            new Date(scheduledAt.getTime() + 60_000)
        );
        if (conflict.length > 0) throw new AppError('Este horário já foi reservado. Por favor, escolha outro.', 409);

        // Upsert: busca por celular, cria se não existir
        const normalizedPhone = phone.trim();
        let patient = await this.repository.findPatientByPhone(tenantId, normalizedPhone);
        if (!patient) {
            patient = await this.repository.savePatient({
                tenantId,
                name: name.trim(),
                phone: normalizedPhone,
                status: 'one_off',
                reminderChannel: 'whatsapp',
            });
        }

        const slots = await this.repository.listAvailabilitySlots(tenantId);
        // Comparar com a grade de disponibilidade no fuso de negócio (BRT, -03:00),
        // independente do fuso do servidor (UTC em produção).
        const brtWall = new Date(scheduledAt.getTime() - 3 * 60 * 60 * 1000);
        const dow = brtWall.getUTCDay();
        const hhmm = `${String(brtWall.getUTCHours()).padStart(2, '0')}:${String(brtWall.getUTCMinutes()).padStart(2, '0')}`;
        const matchingSlot = slots.find(s => s.dayOfWeek === dow && s.startTime === hhmm && s.isActive);
        const durationMinutes = matchingSlot?.durationMinutes ?? 50;

        const appointment = await this.repository.saveAppointment({
            tenantId,
            patientId: patient.id,
            scheduledAt,
            durationMinutes,
            status: 'scheduled',
            recurrence: 'none',
        });

        this.syncGoogleCalendar(appointment, tenantId, patient.name, patient.phone).catch(err => {
            logger.warn({ err }, 'Falha ao sincronizar self-booking com Google Calendar');
        });

        return appointment;
    }

    private async syncGoogleCalendar(
        appointment: PsychotherapyAppointment,
        tenantId: string,
        patientName: string,
        phone: string | null
    ): Promise<void> {
        const confirmUrl = `${APP_BASE_URL}/confirm/${appointment.confirmToken}`;
        await this.googleCalendar.syncAppointment(tenantId, appointment, patientName, phone, confirmUrl);
    }
}
