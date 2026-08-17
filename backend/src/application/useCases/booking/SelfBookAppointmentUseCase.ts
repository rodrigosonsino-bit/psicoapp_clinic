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

        // Exige o instante exato do slot (sem segundos/ms) — sem isso, um horário como
        // 10:00:37 também casaria com o slot "10:00" na comparação por HH:mm abaixo,
        // permitindo agendar fora da grade real do terapeuta.
        if (scheduledAt.getUTCSeconds() !== 0 || scheduledAt.getUTCMilliseconds() !== 0) {
            throw new AppError('Horário inválido para agendamento.', 400);
        }

        const conflict = await this.repository.listActiveAppointmentDatetimes(
            tenantId,
            new Date(scheduledAt.getTime() - 60_000),
            new Date(scheduledAt.getTime() + 60_000)
        );
        if (conflict.length > 0) throw new AppError('Este horário já foi reservado. Por favor, escolha outro.', 409);

        // Valida contra a grade de disponibilidade ANTES de criar/tocar o paciente — sem
        // isso, uma tentativa fora da grade cria um paciente órfão antes de descobrir que
        // o slot não existe (achado da auditoria do Codex de 2026-08-17).
        // Comparar no fuso de negócio (BRT, -03:00 fixo), independente do fuso do
        // servidor (UTC em produção).
        const slots = await this.repository.listAvailabilitySlots(tenantId);
        const brtWall = new Date(scheduledAt.getTime() - 3 * 60 * 60 * 1000);
        const dow = brtWall.getUTCDay();
        const hhmm = `${String(brtWall.getUTCHours()).padStart(2, '0')}:${String(brtWall.getUTCMinutes()).padStart(2, '0')}`;
        const matchingSlot = slots.find(s => s.dayOfWeek === dow && s.startTime === hhmm && s.isActive);
        if (!matchingSlot) throw new AppError('Este horário não está disponível para agendamento.', 409);
        const durationMinutes = matchingSlot.durationMinutes;

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
