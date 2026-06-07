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

    async execute(data: SaveAppointmentDTO & { mode?: 'single' | 'future' | 'all' }): Promise<PsychotherapyAppointment> {
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

        if (!data.id) {
            if (data.recurrence && data.recurrence !== 'none' && data.recurrenceEndDate) {
                const occurrences = this.calculateOccurrences(data.scheduledAt, data.recurrenceEndDate, data.recurrence);
                if (occurrences.length > 52) {
                    throw new AppError('Máximo de 52 ocorrências por série recorrente', 400);
                }

                const rootAppointment = await this.repository.saveAppointment(data);
                this.syncWithGoogleCalendar(rootAppointment, data.tenantId).catch(err => {
                    logger.error({ err, appointmentId: rootAppointment.id }, 'Falha no sync Google Calendar (background)');
                });

                await this.generateChildren(rootAppointment.id, data, occurrences);
                return rootAppointment;
            } else {
                const appointment = await this.repository.saveAppointment(data);
                this.syncWithGoogleCalendar(appointment, data.tenantId).catch(err => {
                    logger.error({ err, appointmentId: appointment.id }, 'Falha no sync Google Calendar (background)');
                });
                return appointment;
            }
        }

        const mode = data.mode ?? 'single';

        if (mode === 'single') {
            const appointment = await this.repository.saveAppointment(data);
            this.syncWithGoogleCalendar(appointment, data.tenantId).catch(err => {
                logger.error({ err, appointmentId: appointment.id }, 'Falha no sync Google Calendar (background)');
            });

            if (data.recurrence && data.recurrence !== 'none' && data.recurrenceEndDate && !appointment.parentId) {
                const series = await this.repository.listSeriesAppointments(data.tenantId, appointment.id);
                if (series.length <= 1) {
                    const occurrences = this.calculateOccurrences(data.scheduledAt, data.recurrenceEndDate, data.recurrence);
                    if (occurrences.length > 52) {
                        throw new AppError('Máximo de 52 ocorrências por série recorrente', 400);
                    }
                    await this.generateChildren(appointment.id, data, occurrences);
                }
            }

            return appointment;
        }

        const currentAppt = await this.repository.findAppointmentById(data.tenantId, data.id);
        if (!currentAppt) {
            throw new AppError('Agendamento não encontrado', 404);
        }

        const deltaMs = data.scheduledAt.getTime() - currentAppt.scheduledAt.getTime();

        const updatedTarget = await this.repository.saveAppointment(data);
        this.syncWithGoogleCalendar(updatedTarget, data.tenantId).catch(err => {
            logger.error({ err, appointmentId: updatedTarget.id }, 'Falha no sync Google Calendar (background)');
        });

        const rootId = currentAppt.parentId ?? currentAppt.id;
        const series = await this.repository.listSeriesAppointments(data.tenantId, rootId);

        for (const sibling of series) {
            if (sibling.id === updatedTarget.id) {
                continue;
            }

            if (mode === 'future' && sibling.scheduledAt < currentAppt.scheduledAt) {
                continue;
            }

            const newScheduledAt = new Date(sibling.scheduledAt.getTime() + deltaMs);
            const childUpdate = await this.repository.saveAppointment({
                id: sibling.id,
                tenantId: data.tenantId,
                patientId: sibling.patientId,
                scheduledAt: newScheduledAt,
                durationMinutes: data.durationMinutes ?? sibling.durationMinutes,
                notes: data.notes !== undefined ? data.notes : sibling.notes,
                status: sibling.status,
                parentId: sibling.parentId
            });

            this.syncWithGoogleCalendar(childUpdate, data.tenantId).catch(err => {
                logger.error({ err, appointmentId: childUpdate.id }, 'Falha no sync Google Calendar (background)');
            });
        }

        return updatedTarget;
    }

    private calculateOccurrences(start: Date, endDate: Date, recurrence: 'weekly' | 'biweekly'): Date[] {
        const intervalDays = recurrence === 'weekly' ? 7 : 14;
        const occurrences: Date[] = [start];
        let current = new Date(start);
        while (true) {
            const next = new Date(current);
            next.setDate(next.getDate() + intervalDays);
            if (next > endDate) break;
            occurrences.push(next);
            current = next;
        }
        return occurrences;
    }

    private async generateChildren(
        rootId: string,
        data: SaveAppointmentDTO & { mode?: 'single' | 'future' | 'all' },
        occurrences: Date[]
    ): Promise<void> {
        for (let i = 1; i < occurrences.length; i++) {
            await this.repository.saveAppointment({
                tenantId: data.tenantId,
                patientId: data.patientId,
                scheduledAt: occurrences[i],
                durationMinutes: data.durationMinutes,
                status: 'scheduled',
                recurrence: 'none',
                recurrenceEndDate: null,
                notes: data.notes,
                parentId: rootId
            });
            // Filhos não são sincronizados individualmente com o GCal:
            // o evento recorrente criado para o root (via RRULE) cobre todas as ocorrências.
            // O pull-sync (cron de 5 min) vinculará cada filho ao seu google_event_id correspondente.
        }
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
