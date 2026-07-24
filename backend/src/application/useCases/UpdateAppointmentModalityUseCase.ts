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

    async execute(tenantId: string, appointmentId: string, modality: 'online' | 'presencial', applyTo: 'single' | 'series' = 'single'): Promise<PsychotherapyAppointment> {
        const appointment = await this.repository.findAppointmentById(tenantId, appointmentId);
        if (!appointment) {
            throw new AppError('Agendamento não encontrado', 404);
        }
        if (appointment.tenantId !== tenantId) {
            throw new AppError('Acesso negado', 403);
        }

        const patient = await this.repository.findPatientById(tenantId, appointment.patientId);
        const baseUrl = process.env.PUBLIC_APP_URL || 'https://psicoapp-lemon.vercel.app';
        const getConfirmUrl = (token: string | null) => token ? `${baseUrl}/c/${token}` : '';

        if (applyTo === 'single' || appointment.recurrence === 'none') {
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
                parentId: appointment.parentId,
                groupId: appointment.groupId
            });

            if (appointment.modality !== modality && patient) {
                this.googleCalendarService.syncAppointment(
                    tenantId, saved, patient.name, patient.phone || null, getConfirmUrl(saved.confirmToken)
                ).catch(err => console.error('Erro ao sincronizar GCal (single modality):', err));
            }
            return saved;
        }

        // --- applyTo === 'series' logic ---
        const rootId = appointment.parentId || appointment.id;
        const series = await this.repository.listSeriesAppointments(tenantId, rootId);
        
        // 1. Truncate old root if anchor is not the root
        if (rootId !== appointment.id) {
            const oldRoot = series.find(a => a.id === rootId);
            if (oldRoot) {
                const newEndDate = new Date(appointment.scheduledAt.getTime() - 1000); // just before anchor
                const savedOldRoot = await this.repository.saveAppointment({
                    id: oldRoot.id,
                    tenantId: oldRoot.tenantId,
                    patientId: oldRoot.patientId,
                    scheduledAt: oldRoot.scheduledAt,
                    durationMinutes: oldRoot.durationMinutes,
                    status: oldRoot.status,
                    modality: oldRoot.modality,
                    notes: oldRoot.notes,
                    recurrence: oldRoot.recurrence,
                    recurrenceEndDate: newEndDate,
                    parentId: null,
                    groupId: oldRoot.groupId
                });
                
                if (patient) {
                    this.googleCalendarService.syncAppointment(
                        tenantId, savedOldRoot, patient.name, patient.phone || null, getConfirmUrl(savedOldRoot.confirmToken)
                    ).catch(err => console.error('Erro GCal (truncate old root):', err));
                }
            }
        }

        // 2. Make anchor the new root
        const savedAnchor = await this.repository.saveAppointment({
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
            parentId: null, // New root!
            groupId: appointment.groupId
        });

        if (patient) {
            this.googleCalendarService.syncAppointment(
                tenantId, savedAnchor, patient.name, patient.phone || null, getConfirmUrl(savedAnchor.confirmToken)
            ).catch(err => console.error('Erro GCal (new root sync):', err));
        }

        // 3. Update future siblings to point to the new root and inherit modality
        const futureSiblings = series.filter(a => 
            a.id !== appointment.id && a.scheduledAt.getTime() > appointment.scheduledAt.getTime()
        );

        for (const sibling of futureSiblings) {
            await this.repository.saveAppointment({
                id: sibling.id,
                tenantId: sibling.tenantId,
                patientId: sibling.patientId,
                scheduledAt: sibling.scheduledAt,
                durationMinutes: sibling.durationMinutes,
                status: sibling.status,
                modality: modality,
                notes: sibling.notes,
                recurrence: 'none', // children don't carry recurrence rule
                recurrenceEndDate: null,
                parentId: savedAnchor.id,
                groupId: sibling.groupId
            });
        }

        return savedAnchor;
    }
}
