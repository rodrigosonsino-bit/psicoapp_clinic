import * as cron from 'node-cron';
import { IPsychotherapyRepository, UpcomingAppointment } from '../../domain/repositories/IPsychotherapyRepository';
import { logger } from '../logger';
import { WhatsappSessionManager } from '@antigravity/whatsapp-core';
import { EmailService } from '../services/EmailService';

// ── Formatação ─────────────────────────────────────────────────────────────────

function formatDateTimeBR(date: Date): string {
    return date.toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

const DEFAULT_REMINDER_TEMPLATE =
    `Olá, {nome}! 😊\n\n` +
    `Lembrando que você tem uma sessão agendada:\n` +
    `📅 {data}\n` +
    `⏱️ Duração: {duracao} minutos\n\n` +
    `Por favor, confirme sua presença respondendo esta mensagem.\n` +
    `Caso precise reagendar, entre em contato com antecedência.`;

function buildWhatsAppMessage(appointment: UpcomingAppointment): string {
    const dateStr = formatDateTimeBR(appointment.scheduledAt);
    const template = appointment.whatsappReminderTemplate?.trim() || DEFAULT_REMINDER_TEMPLATE;

    return template
        .replace(/{nome}/g, appointment.patientName)
        .replace(/{data}/g, dateStr)
        .replace(/{duracao}/g, String(appointment.durationMinutes));
}

// ── Resultado do processamento ─────────────────────────────────────────────────

export interface ReminderRunResult {
    totalAppointments: number;
    whatsappSent: number;
    whatsappFailed: number;
    emailSent: number;
    emailFailed: number;
    skipped: number;
    whatsappRetried: number;
}

/** Máximo de tentativas de WhatsApp por agendamento antes de desistir definitivamente. */
const MAX_WHATSAPP_ATTEMPTS = 5;

// ── Scheduler ──────────────────────────────────────────────────────────────────

export class ReminderScheduler {
    private task: ReturnType<typeof cron.schedule> | null = null;
    private readonly emailService = new EmailService();

    constructor(
        private readonly repository: IPsychotherapyRepository,
        private readonly whatsappSessionManager?: WhatsappSessionManager
    ) {}

    /** Inicia o cron — executa de hora em hora no minuto 0. */
    start(): void {
        this.task = cron.schedule('0 * * * *', async () => {
            await this.processReminders();
        }, { timezone: 'America/Sao_Paulo' });

        logger.info('🔔 Scheduler de lembretes iniciado (executa de hora em hora)');
    }

    stop(): void {
        this.task?.stop();
        logger.info('🔕 Scheduler de lembretes parado');
    }

    /**
     * Processa os lembretes pendentes para as próximas ~24 horas.
     * Pode ser chamado manualmente (ex: via endpoint de teste).
     */
    async processReminders(): Promise<ReminderRunResult> {
        const result: ReminderRunResult = {
            totalAppointments: 0,
            whatsappSent: 0,
            whatsappFailed: 0,
            emailSent: 0,
            emailFailed: 0,
            skipped: 0,
            whatsappRetried: 0,
        };

        try {
            // Janela: 23h–25h a partir de agora (cobre 1 execução/hora sem lacunas)
            const now = new Date();
            const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
            const windowEnd   = new Date(now.getTime() + 25 * 60 * 60 * 1000);

            const appointments = await this.repository.findUpcomingAppointments(windowStart, windowEnd);
            result.totalAppointments = appointments.length;

            if (appointments.length > 0) {
                logger.info({ count: appointments.length }, '🔔 Processando lembretes de agendamentos');

                for (const appt of appointments) {
                    await this.dispatchReminder(appt, result);
                }
            }

            // Retry: agendamentos cuja janela normal já passou mas o WhatsApp falhou (ex: sessão desconectada)
            // e a sessão ainda não aconteceu — tenta de novo em vez de desistir silenciosamente.
            const retryCandidates = await this.repository.findFailedWhatsappReminders(now, windowStart, MAX_WHATSAPP_ATTEMPTS);
            if (retryCandidates.length > 0) {
                logger.info({ count: retryCandidates.length }, '🔁 Reprocessando lembretes de WhatsApp que falharam anteriormente');
                for (const appt of retryCandidates) {
                    if (!appt.patientPhone) continue;
                    result.whatsappRetried++;
                    await this.sendViaWhatsApp(appt, result);
                }
            }

            logger.info(result, '🔔 Ciclo de lembretes concluído');
        } catch (err) {
            logger.error({ err }, 'Erro ao processar lembretes de agendamentos');
        }

        return result;
    }

    // ── Despacho por canal ─────────────────────────────────────────────────────

    private async dispatchReminder(
        appt: UpcomingAppointment,
        result: ReminderRunResult
    ): Promise<void> {
        const channel = appt.reminderChannel;

        const needsWhatsApp = channel === 'whatsapp' || channel === 'both';
        const needsEmail    = channel === 'email'    || channel === 'both';

        // ── WhatsApp ─────────────────────────────────────────────────────────
        if (needsWhatsApp) {
            const alreadySent = await this.repository.hasReminderBeenSent(appt.appointmentId, 'whatsapp');
            if (alreadySent) {
                result.skipped++;
            } else if (!appt.patientPhone) {
                logger.warn({ appointmentId: appt.appointmentId, patientName: appt.patientName },
                    '⚠️ Paciente sem telefone — WhatsApp não enviado');
                result.skipped++;
            } else {
                await this.sendViaWhatsApp(appt, result);
            }
        }

        // ── Email ─────────────────────────────────────────────────────────────
        if (needsEmail) {
            const alreadySent = await this.repository.hasReminderBeenSent(appt.appointmentId, 'email');
            if (alreadySent) {
                result.skipped++;
            } else if (!appt.patientEmail) {
                logger.warn({ appointmentId: appt.appointmentId, patientName: appt.patientName },
                    '⚠️ Paciente sem e-mail — e-mail não enviado');
                result.skipped++;
            } else {
                await this.sendViaEmail(appt, result);
            }
        }
    }

    // ── Envio WhatsApp ─────────────────────────────────────────────────────────

    private async sendViaWhatsApp(
        appt: UpcomingAppointment,
        result: ReminderRunResult
    ): Promise<void> {
        const message = buildWhatsAppMessage(appt);

        if (!this.whatsappSessionManager) {
            logger.warn({ appointmentId: appt.appointmentId },
                '⚠️ WhatsappSessionManager não disponível — WhatsApp não enviado');
            result.skipped++;
            return;
        }

        try {
            const client = await this.whatsappSessionManager.getSession(appt.tenantId);
            if (!client || !client.isConnected()) {
                throw new Error('Sessão WhatsApp não conectada para este tenant');
            }

            await client.sendMessage(appt.patientPhone!, message);
            await this.repository.markReminderSent(appt.appointmentId, appt.tenantId, 'whatsapp', 'success');

            logger.info({
                appointmentId: appt.appointmentId,
                tenantId: appt.tenantId,
                patientName: appt.patientName,
                scheduledAt: appt.scheduledAt,
            }, '✅ Lembrete enviado via WhatsApp');

            result.whatsappSent++;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            await this.repository.markReminderSent(
                appt.appointmentId, appt.tenantId, 'whatsapp', 'failed', errorMsg
            );
            logger.error({ err, appointmentId: appt.appointmentId }, '❌ Falha ao enviar lembrete via WhatsApp');
            result.whatsappFailed++;
        }
    }

    // ── Envio Email ────────────────────────────────────────────────────────────

    private async sendViaEmail(
        appt: UpcomingAppointment,
        result: ReminderRunResult
    ): Promise<void> {
        try {
            await this.emailService.sendAppointmentReminder({
                to: appt.patientEmail!,
                patientName: appt.patientName,
                therapistName: appt.tenantName,
                scheduledAt: appt.scheduledAt,
                durationMinutes: appt.durationMinutes,
            });

            await this.repository.markReminderSent(appt.appointmentId, appt.tenantId, 'email', 'success');
            result.emailSent++;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            await this.repository.markReminderSent(
                appt.appointmentId, appt.tenantId, 'email', 'failed', errorMsg
            );
            logger.error({ err, appointmentId: appt.appointmentId }, '❌ Falha ao enviar lembrete por e-mail');
            result.emailFailed++;
        }
    }
}
