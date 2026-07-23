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
        const appointment = await this.repository.findAppointmentById(tenantId, appointmentId);
        if (!appointment) {
            throw new AppError('Agendamento não encontrado', 404);
        }
        if (appointment.tenantId !== tenantId) {
            throw new AppError('Acesso negado', 403);
        }
        const oldModality = appointment.modality;
        // Ao invés de criar um save parcial, vou fazer o update completo via saveAppointment
        const saved = await this.repository.saveAppointment({
            id: appointment.id,
            tenantId: appointment.tenantId,
            patientId: appointment.patientId,
            scheduledAt: appointment.scheduledAt,
            durationMinutes: appointment.durationMinutes,
            status: appointment.status,
            modality: modality,
            notes: appointment.notes,
            recurrence: appointment.recurrence,
            recurrenceEndDate: appointment.recurrenceEndDate,
            groupId: appointment.groupId
        });

        if (oldModality !== modality) {
            try {
                const patient = await this.repository.findPatientById(tenantId, appointment.patientId);
                const baseUrl = process.env.PUBLIC_APP_URL || 'https://psicoapp-lemon.vercel.app';
                const confirmUrl = `${baseUrl}/c/${saved.confirmToken}`;
                if (patient) {
                    await this.googleCalendarService.syncAppointment(
                        tenantId,
                        saved,
                        patient.name,
                        patient.phone || null,
                        confirmUrl
                    );
                }
            } catch (err: any) {
                console.error('Erro ao sincronizar com Google Calendar (modality change):', err);
            }
        }

        return saved;
    }
}
