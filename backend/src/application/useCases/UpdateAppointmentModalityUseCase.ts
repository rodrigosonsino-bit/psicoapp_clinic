import { inject, injectable } from 'tsyringe';
import { AppError } from '../../domain/errors/AppError';
import type { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';
import { GoogleCalendarService } from '../../infrastructure/google/GoogleCalendarService';
import type { PsychotherapyAppointment } from '../../domain/models/PsychotherapyAppointment';

@injectable()
export class UpdateAppointmentModalityUseCase {
    constructor(
        @inject('IPsychotherapyRepository')
        private repository: IPsychotherapyRepository,
        @inject('GoogleCalendarService')
        private googleCalendarService: GoogleCalendarService
    ) { }

    async execute(tenantId: string, appointmentId: string, modality: 'online' | 'presencial'): Promise<PsychotherapyAppointment> {
        const appointment = await this.repository.findById(appointmentId);
        if (!appointment) {
            throw new AppError('Agendamento não encontrado', 404);
        }
        if (appointment.tenantId !== tenantId) {
            throw new AppError('Acesso negado', 403);
        }

        const oldModality = appointment.modality;
        appointment.modality = modality;

        // Ao invés de criar um save parcial, vou fazer o update completo via saveAppointment
        const saved = await this.repository.saveAppointment({
            id: appointment.id,
            tenantId: appointment.tenantId,
            patientId: appointment.patientId,
            scheduledAt: appointment.scheduledAt,
            durationMinutes: appointment.durationMinutes,
            status: appointment.status,
            modality: appointment.modality,
            notes: appointment.notes,
            recurrence: appointment.recurrence,
            recurrenceEndDate: appointment.recurrenceEndDate,
            groupId: appointment.groupId
        });

        if (oldModality !== modality) {
            try {
                await this.googleCalendarService.syncAppointment(saved);
            } catch (err: any) {
                console.error('Erro ao sincronizar com Google Calendar (modality change):', err);
            }
        }

        return saved;
    }
}
