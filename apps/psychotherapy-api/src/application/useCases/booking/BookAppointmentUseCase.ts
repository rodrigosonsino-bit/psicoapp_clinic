import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository } from '../../../domain/repositories/IPsychotherapyRepository';
import { PsychotherapyAppointment } from '../../../domain/models/PsychotherapyAppointment';
import { GoogleCalendarService } from '../../../infrastructure/google/GoogleCalendarService';
import { AppError } from '../../../domain/errors/AppError';
import { logger } from '../../../infrastructure/logger';

const APP_BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:5173';

@injectable()
export class BookAppointmentUseCase {
    constructor(
        @inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository,
        @inject('GoogleCalendarService') private readonly googleCalendar: GoogleCalendarService
    ) {}

    async execute(token: string, scheduledAtISO: string): Promise<PsychotherapyAppointment> {
        const link = await this.repository.findBookingLinkByToken(token);
        if (!link || !link.isActive) throw new AppError('Link de agendamento inválido ou desativado.', 404);
        if (link.isExpired) throw new AppError('Este link de agendamento expirou.', 410);

        const scheduledAt = new Date(scheduledAtISO);
        if (isNaN(scheduledAt.getTime())) throw new AppError('Data/hora inválida.', 400);
        if (scheduledAt <= new Date()) throw new AppError('Não é possível agendar no passado.', 400);

        // Verifica se o horário ainda está disponível (sem corrida crítica — aceitável para MVP)
        const existingAtSameTime = await this.repository.listActiveAppointmentDatetimes(
            link.tenantId,
            new Date(scheduledAt.getTime() - 60_000),
            new Date(scheduledAt.getTime() + 60_000)
        );
        if (existingAtSameTime.length > 0) {
            throw new AppError('Este horário já foi reservado. Por favor, escolha outro.', 409);
        }

        // Busca a duração do slot correspondente
        const slots = await this.repository.listAvailabilitySlots(link.tenantId);
        // Comparar com a grade de disponibilidade no fuso de negócio (BRT, -03:00),
        // independente do fuso do servidor (UTC em produção).
        const brtWall = new Date(scheduledAt.getTime() - 3 * 60 * 60 * 1000);
        const dow = brtWall.getUTCDay();
        const hhmm = `${String(brtWall.getUTCHours()).padStart(2, '0')}:${String(brtWall.getUTCMinutes()).padStart(2, '0')}`;
        const matchingSlot = slots.find(s => s.dayOfWeek === dow && s.startTime === hhmm && s.isActive);
        const durationMinutes = matchingSlot?.durationMinutes ?? 50;

        const appointment = await this.repository.saveAppointment({
            tenantId: link.tenantId,
            patientId: link.patientId,
            scheduledAt,
            durationMinutes,
            status: 'scheduled',
            recurrence: 'none',
        });

        // Sync Google Calendar em background
        this.syncGoogleCalendar(appointment, link.tenantId).catch(err => {
            logger.warn({ err }, 'Falha ao sincronizar agendamento do paciente com Google Calendar');
        });

        return appointment;
    }

    private async syncGoogleCalendar(appointment: PsychotherapyAppointment, tenantId: string): Promise<void> {
        const patient = await this.repository.findPatientById(tenantId, appointment.patientId);
        if (!patient) return;
        const confirmUrl = `${APP_BASE_URL}/confirm/${appointment.confirmToken}`;
        await this.googleCalendar.syncAppointment(tenantId, appointment, patient.name, patient.phone, confirmUrl);
    }
}
