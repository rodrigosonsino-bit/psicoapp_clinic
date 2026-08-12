import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';
import { GoogleCalendarService } from '../../infrastructure/google/GoogleCalendarService';
import { PsychotherapyAppointment } from '../../domain/models/PsychotherapyAppointment';
import { logger } from '../../infrastructure/logger';

@injectable()
export class DeletePsychotherapyAppointmentUseCase {
    constructor(
        @inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository,
        @inject('GoogleCalendarService') private readonly googleCalendar: GoogleCalendarService
    ) {}

    async execute(tenantId: string, id: string, mode: 'single' | 'future' | 'all' = 'single'): Promise<void> {
        const appointment = await this.repository.findAppointmentById(tenantId, id);
        if (!appointment) return;

        if (mode === 'single') {
            await this.repository.deleteAppointment(tenantId, id);
            await this.deleteGoogleEventSafely(tenantId, appointment);
            return;
        }

        const rootId = appointment.parentId ?? appointment.id;
        const series = await this.repository.listSeriesAppointments(tenantId, rootId);

        let targets = series;
        if (mode === 'future') {
            targets = series.filter(a => a.scheduledAt >= appointment.scheduledAt);
        }

        // Filhos primeiro, root por último: quando o root também está entre os
        // alvos, seus filhos ativos já terão sido apagados do banco antes de
        // chegarmos nele — deleteGoogleEventSafely então reavalia
        // corretamente que não sobrou filho ativo e libera a exclusão normal
        // do evento mestre (a intenção aqui é mesmo encerrar a série toda).
        const sortedTargets = [...targets].sort((a, b) => {
            if (a.parentId && !b.parentId) return -1;
            if (!a.parentId && b.parentId) return 1;
            return 0;
        });

        for (const target of sortedTargets) {
            await this.repository.deleteAppointment(tenantId, target.id);
            await this.deleteGoogleEventSafely(tenantId, target);
        }
    }

    /**
     * Excluir o ROOT de uma série recorrente ainda com filhos ativos apaga o
     * evento MESTRE inteiro no Google (mesmo evento compartilha o RRULE com
     * toda a série) — mesma classe de problema do BUG 3, mas pelo caminho de
     * exclusão em vez de cancelamento de status. Detectado em produção:
     * excluir uma única sessão-raiz (mode='single') derrubou a série inteira
     * no Google Calendar, mesmo com sessões futuras ainda agendadas no app.
     *
     * Se o alvo é root de série ativa (recurrence != 'none') com pelo menos
     * um filho scheduled/confirmed, cancela só a instância específica dessa
     * sessão via cancelRecurringInstance, preservando o master. Caso
     * contrário (avulso, filho, ou série já sem filhos ativos), remove o
     * evento normalmente.
     */
    private async deleteGoogleEventSafely(tenantId: string, appointment: PsychotherapyAppointment): Promise<void> {
        if (!appointment.googleEventId) return;

        if (!appointment.parentId && appointment.recurrence !== 'none') {
            const seriesMembers = await this.repository.listSeriesAppointments(tenantId, appointment.id);
            const hasActiveChild = seriesMembers.some(
                m => m.id !== appointment.id && (m.status === 'scheduled' || m.status === 'confirmed')
            );
            if (hasActiveChild) {
                const occurrenceMatch = /^(.+)_[0-9]{8}T[0-9]{6}Z$/.exec(appointment.googleEventId);
                const masterEventId = occurrenceMatch ? occurrenceMatch[1] : appointment.googleEventId;
                const cancelled = await this.googleCalendar.cancelRecurringInstance(
                    tenantId, masterEventId, appointment.scheduledAt
                );
                logger.warn(
                    { tenantId, appointmentId: appointment.id, cancelled },
                    cancelled
                        ? '✂️ Root de série recorrente excluído do app — só a instância dessa sessão foi cancelada no Google, série preservada'
                        : '⛔ Root de série recorrente excluído do app, mas a série tem filhos ativos — exclusão do evento mestre no Google bloqueada para não cancelar a série inteira'
                );
                return;
            }
        }

        this.googleCalendar.deleteEvent(tenantId, appointment.googleEventId).catch(err => {
            logger.warn({ err, appointmentId: appointment.id }, 'Falha ao remover evento do Google Calendar');
        });
    }
}
