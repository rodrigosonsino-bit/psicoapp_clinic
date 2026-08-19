import { injectable, inject } from 'tsyringe';
import { PsychotherapyAppointment, RecurrenceType } from '../../domain/models/PsychotherapyAppointment';
import { IPsychotherapyRepository, SaveAppointmentDTO } from '../../domain/repositories/IPsychotherapyRepository';
import { GoogleCalendarService } from '../../infrastructure/google/GoogleCalendarService';
import { DeletePsychotherapyAppointmentUseCase } from './DeletePsychotherapyAppointmentUseCase';
import { AppError } from '../../domain/errors/AppError';
import { PsychotherapyPatient } from '../../domain/models/PsychotherapyPatient';
import { logger } from '../../infrastructure/logger';
import { PASTORAL_SENTINEL_EMAIL, PASTORAL_SUMMARY_PREFIX } from '../../domain/constants/pastoral';

const APP_BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:3000';

@injectable()
export class SavePsychotherapyAppointmentUseCase {
    constructor(
        @inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository,
        @inject('GoogleCalendarService') private readonly googleCalendar: GoogleCalendarService,
        private readonly deleteUseCase: DeletePsychotherapyAppointmentUseCase
    ) {}

    async execute(data: SaveAppointmentDTO & { mode?: 'single' | 'future' | 'all'; allowPast?: boolean }): Promise<PsychotherapyAppointment> {
        if (data.notes?.startsWith(PASTORAL_SUMMARY_PREFIX)) {
            const virtualPatient = await this.findOrCreatePastoralPatient(data.tenantId);
            data.patientId = virtualPatient.id;
        }

        // Bloqueia datas passadas no fluxo normal, mas permite registro retroativo
        // explícito (sessão de emergência já realizada) via allowPast.
        if (data.scheduledAt <= new Date(Date.now() - 60_000) && !data.id && !data.allowPast) {
            throw new AppError('Não é possível agendar sessões no passado', 400);
        }
        // Agendamento retroativo só faz sentido como sessão avulsa (não recorrente).
        if (data.allowPast && data.recurrence && data.recurrence !== 'none') {
            throw new AppError('Atendimento retroativo não pode ser recorrente', 400);
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
        // Cap de 3 meses só na CRIAÇÃO de série nova (não retroativo a séries
        // já existentes, nem a edições de recorrência de uma série antiga —
        // decisão explícita do usuário). Sem isso, séries recorrentes correm
        // indefinidamente sem checkpoint, o que já causou descompasso real
        // entre agenda e faturamento (caso Almira, 2026-08-13).
        if (!data.id && data.recurrence && data.recurrence !== 'none' && data.recurrenceEndDate) {
            const maxRecurrenceEndDate = this.addMonths(data.scheduledAt, 3);
            if (data.recurrenceEndDate > maxRecurrenceEndDate) {
                throw new AppError('Séries recorrentes novas podem durar no máximo 3 meses. Ao final desse período, você poderá renovar pelo painel ou WhatsApp.', 400);
            }
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
            const before = await this.repository.findAppointmentById(data.tenantId, data.id);
            const appointment = await this.repository.saveAppointment(data);
            this.syncWithGoogleCalendar(appointment, data.tenantId).catch(err => {
                logger.error({ err, appointmentId: appointment.id }, 'Falha no sync Google Calendar (background)');
            });

            if (before && before.recurrence !== appointment.recurrence) {
                try {
                    await this.pruneStraySiblings(appointment);
                } catch (err) {
                    logger.error({ err, appointmentId: appointment.id }, 'Falha ao remover sessões futuras fora do novo padrão de recorrência');
                }

                if (appointment.recurrence !== 'none' && appointment.recurrenceEndDate) {
                    try {
                        await this.generateMissingOccurrences(appointment);
                    } catch (err) {
                        logger.error({ err, appointmentId: appointment.id }, 'Falha ao gerar novas sessões futuras da série recorrente');
                    }
                }

                try {
                    await this.splitSeriesInGoogleCalendar(appointment);
                } catch (err) {
                    logger.error({ err, appointmentId: appointment.id }, 'Falha ao dividir a série no Google Calendar após mudança de recorrência');
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

    /**
     * Renova uma série recorrente estendendo `recurrenceEndDate` a partir do fim atual
     * (não a partir de hoje — evita sobrepor/pular ocorrências se a renovação acontecer
     * antes do último dia) e gerando as ocorrências que faltam no novo trecho. Diferente
     * do fluxo de edição normal (mode='single'), que só chama `generateMissingOccurrences`
     * quando o TIPO de recorrência muda — aqui o tipo permanece igual, só a data final
     * avança, então chamamos o gerador diretamente.
     */
    async renewSeries(tenantId: string, rootAppointmentId: string, additionalMonths: number): Promise<PsychotherapyAppointment> {
        const root = await this.repository.findAppointmentById(tenantId, rootAppointmentId);
        if (!root) {
            throw new AppError('Agendamento não encontrado', 404);
        }
        if (root.parentId) {
            throw new AppError('Só é possível renovar a partir do agendamento raiz da série', 400);
        }
        if (root.recurrence === 'none' || !root.recurrenceEndDate) {
            throw new AppError('Este agendamento não é uma série recorrente', 400);
        }

        const newEndDate = this.addMonths(root.recurrenceEndDate, additionalMonths);

        const updatedRoot = await this.repository.saveAppointment({
            id: root.id,
            tenantId,
            patientId: root.patientId,
            scheduledAt: root.scheduledAt,
            durationMinutes: root.durationMinutes,
            status: root.status,
            recurrence: root.recurrence,
            recurrenceEndDate: newEndDate,
            notes: root.notes,
            parentId: null
        });

        await this.generateMissingOccurrences(updatedRoot);

        return updatedRoot;
    }

    /**
     * Quando a recorrência de um agendamento é alterada (ex.: semanal → quinzenal),
     * remove automaticamente as sessões futuras da mesma série que não se encaixam
     * mais no novo padrão, a partir da data do agendamento editado (âncora).
     *
     * Regras de segurança:
     * - Nunca remove sessões anteriores ou iguais à âncora.
     * - Nunca remove sessões já concluídas/canceladas (status diferente de
     *   'scheduled'/'confirmed') — protege histórico e faturamento.
     * - Se a nova recorrência for 'none', todas as sessões futuras da série são
     *   removidas (a âncora passa a ser avulsa).
     */
    private async pruneStraySiblings(anchor: PsychotherapyAppointment): Promise<void> {
        const rootId = anchor.parentId ?? anchor.id;
        const series = await this.repository.listSeriesAppointments(anchor.tenantId, rootId);

        for (const sibling of series) {
            if (sibling.id === anchor.id) continue;
            if (sibling.scheduledAt.getTime() <= anchor.scheduledAt.getTime()) continue;
            if (sibling.status !== 'scheduled' && sibling.status !== 'confirmed') continue;

            const fitsNewPattern = this.fitsRecurrencePattern(anchor.scheduledAt, sibling.scheduledAt, anchor.recurrence);

            if (!fitsNewPattern) {
                await this.deleteUseCase.execute(anchor.tenantId, sibling.id, 'single');
                logger.info(
                    { tenantId: anchor.tenantId, appointmentId: sibling.id, anchorId: anchor.id, newRecurrence: anchor.recurrence },
                    '🗑️ Sessão futura removida automaticamente (fora do novo padrão de recorrência)'
                );
            }
        }
    }

    /**
     * Quando a recorrência de um agendamento existente é alterada (ex.: avulso → semanal,
     * ou semanal → quinzenal), gera as ocorrências futuras que ainda faltam no novo padrão,
     * a partir da data do agendamento editado (âncora) até `recurrenceEndDate`. Idempotente:
     * só cria o que ainda não existe — `pruneStraySiblings` já roda antes e remove o que não
     * se encaixa mais no novo padrão, então aqui só preenchemos as lacunas restantes.
     */
    private async generateMissingOccurrences(anchor: PsychotherapyAppointment): Promise<void> {
        if (anchor.recurrence === 'none' || !anchor.recurrenceEndDate) return;

        const occurrences = this.calculateOccurrences(anchor.scheduledAt, anchor.recurrenceEndDate, anchor.recurrence);
        if (occurrences.length > 52) {
            throw new AppError('Máximo de 52 ocorrências por série recorrente', 400);
        }

        const rootId = anchor.parentId ?? anchor.id;
        const series = await this.repository.listSeriesAppointments(anchor.tenantId, rootId);
        const existingTimes = new Set(
            series
                .filter(s => s.id !== anchor.id && (s.status === 'scheduled' || s.status === 'confirmed'))
                .map(s => s.scheduledAt.getTime())
        );

        for (let i = 1; i < occurrences.length; i++) {
            const occurrenceDate = occurrences[i];
            if (existingTimes.has(occurrenceDate.getTime())) continue;

            await this.repository.saveAppointment({
                tenantId: anchor.tenantId,
                patientId: anchor.patientId,
                scheduledAt: occurrenceDate,
                durationMinutes: anchor.durationMinutes,
                status: 'scheduled',
                recurrence: 'none',
                recurrenceEndDate: null,
                notes: anchor.notes,
                parentId: rootId
            });
            logger.info(
                { tenantId: anchor.tenantId, anchorId: anchor.id, rootId, occurrenceDate },
                '➕ Sessão futura criada automaticamente (novo padrão de recorrência aplicado na edição)'
            );
        }
    }

    /**
     * Quando a recorrência é alterada a partir de uma sessão que NÃO é o root
     * da série (ex.: mudar de semanal pra quinzenal a partir da 5ª sessão),
     * `pruneStraySiblings`/`generateMissingOccurrences` já corrigem o banco,
     * mas o evento MESTRE recorrente no Google Calendar (que pertence ao
     * root, com o RRULE antigo) nunca é tocado — continuaria gerando
     * ocorrências fantasmas do padrão antigo indefinidamente. Aqui "dividimos"
     * a série no Google: truncamos o RRULE do master antigo um dia antes da
     * âncora, e (se o novo padrão não for 'none') a própria âncora ganha seu
     * próprio evento mestre recorrente novo a partir dali — mesmo padrão que
     * apps de calendário usam em "editar este e os próximos eventos".
     *
     * Quando a âncora É o root (`parentId` nulo), nada a fazer aqui: o
     * `syncWithGoogleCalendar` já disparado em `execute()` reescreve o RRULE
     * do próprio evento mestre do root normalmente.
     */
    private async splitSeriesInGoogleCalendar(anchor: PsychotherapyAppointment): Promise<void> {
        if (!anchor.parentId) return;

        const root = await this.repository.findAppointmentById(anchor.tenantId, anchor.parentId);
        if (root?.googleEventId) {
            await this.googleCalendar.truncateRecurringSeries(anchor.tenantId, root.googleEventId, anchor.scheduledAt);
        }

        if (anchor.recurrence === 'none') return;

        // A âncora vai virar dona de um evento mestre recorrente próprio — força
        // um evento novo em vez de reaproveitar o googleEventId atual (que era
        // uma ocorrência vinculada ao master ANTIGO, incapaz de carregar RRULE).
        await this.repository.advanceAppointmentGoogleEventGeneration(
            anchor.id, anchor.tenantId, anchor.googleEventGeneration
        );
        const fresh = await this.repository.findAppointmentById(anchor.tenantId, anchor.id);
        if (!fresh) return;

        const patient = await this.repository.findPatientById(anchor.tenantId, fresh.patientId);
        if (!patient) return;

        const confirmUrl = `${APP_BASE_URL}/confirm/${fresh.confirmToken}`;
        const isPastoral = patient.email === PASTORAL_SENTINEL_EMAIL;

        await this.googleCalendar.syncAppointment(
            anchor.tenantId, fresh, patient.name, patient.phone, confirmUrl,
            isPastoral, /* forceCreate */ true, /* recoveryDepth */ 0, /* treatAsSeriesRoot */ true
        );
        logger.info(
            { tenantId: anchor.tenantId, appointmentId: anchor.id, rootId: anchor.parentId, newRecurrence: anchor.recurrence },
            '🔀 Série dividida no Google Calendar — novo evento mestre recorrente criado a partir da âncora'
        );
    }

    /**
     * Verifica se `candidate` cai exatamente numa ocorrência da recorrência `recurrence`
     * ancorada em `anchor` (candidate deve ser posterior à âncora). 'weekly'/'biweekly' usam
     * intervalo fixo em dias; 'monthly' não pode usar dias fixos (meses têm duração
     * variável) — compara o dia-do-mês e a diferença inteira de meses em vez disso.
     */
    private fitsRecurrencePattern(anchor: Date, candidate: Date, recurrence: RecurrenceType): boolean {
        if (recurrence === 'weekly' || recurrence === 'biweekly') {
            const intervalDays = recurrence === 'weekly' ? 7 : 14;
            const diffDays = Math.round((candidate.getTime() - anchor.getTime()) / (1000 * 60 * 60 * 24));
            return diffDays % intervalDays === 0;
        }
        if (recurrence === 'monthly') {
            if (candidate.getDate() !== anchor.getDate()) return false;
            const monthsDiff = (candidate.getFullYear() - anchor.getFullYear()) * 12 + (candidate.getMonth() - anchor.getMonth());
            return monthsDiff > 0;
        }
        return false;
    }

    private addMonths(date: Date, months: number): Date {
        const result = new Date(date);
        result.setMonth(result.getMonth() + months);
        return result;
    }

    private calculateOccurrences(start: Date, endDate: Date, recurrence: 'weekly' | 'biweekly' | 'monthly'): Date[] {
        const occurrences: Date[] = [start];
        let current = new Date(start);
        while (true) {
            const next = new Date(current);
            if (recurrence === 'monthly') {
                next.setMonth(next.getMonth() + 1);
            } else {
                next.setDate(next.getDate() + (recurrence === 'weekly' ? 7 : 14));
            }
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
        const isPastoral = patient.email === PASTORAL_SENTINEL_EMAIL;
        await this.googleCalendar.syncAppointment(
            tenantId,
            appointment,
            patient.name,
            patient.phone,
            confirmUrl,
            isPastoral
        );
    }

    private async findOrCreatePastoralPatient(tenantId: string): Promise<any> {
        const patients = await this.repository.listPatients(tenantId) as PsychotherapyPatient[];
        let patient = patients.find(p => p.email === PASTORAL_SENTINEL_EMAIL);
        if (!patient) {
            patient = await this.repository.savePatient({
                tenantId,
                name: 'Atendimento Pastoral',
                status: 'inactive',
                paymentType: null,
                defaultSessionPriceCents: null,
                phone: null,
                email: PASTORAL_SENTINEL_EMAIL,
                reminderChannel: 'none'
            });
            logger.info({ tenantId, patientId: patient.id }, '⛪ Paciente virtual "Atendimento Pastoral" criado (via SaveUsecase)');
        }
        return patient;
    }
}
