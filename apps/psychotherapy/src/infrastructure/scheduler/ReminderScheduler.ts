import * as cron from 'node-cron';
import { IPsychotherapyRepository, UpcomingAppointment } from '../../domain/repositories/IPsychotherapyRepository';
import { logger } from '../logger';
import { WhatsappSessionManager } from '@antigravity/whatsapp-core';

function buildWhatsAppLink(phone: string, message: string): string {
    const cleaned = phone.replace(/\D/g, '');
    const withCountryCode = cleaned.startsWith('55') ? cleaned : `55${cleaned}`;
    return `https://wa.me/${withCountryCode}?text=${encodeURIComponent(message)}`;
}

function formatDateTime(date: Date): string {
    return date.toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function buildReminderMessage(appointment: UpcomingAppointment): string {
    const dateStr = formatDateTime(appointment.scheduledAt);
    return (
        `Olá, ${appointment.patientName}! 😊\n\n` +
        `Lembrando que você tem uma sessão agendada amanhã:\n` +
        `📅 ${dateStr}\n` +
        `⏱️ Duração: ${appointment.durationMinutes} minutos\n\n` +
        `Por favor, confirme sua presença respondendo esta mensagem.\n` +
        `Caso precise reagendar, entre em contato com antecedência.`
    );
}

export class ReminderScheduler {
    private task: ReturnType<typeof cron.schedule> | null = null;

    constructor(
        private readonly repository: IPsychotherapyRepository,
        private readonly whatsappSessionManager?: WhatsappSessionManager
    ) {}

    start(): void {
        // Executa a cada hora, nos minutos 0 (ex: 08:00, 09:00, 10:00...)
        this.task = cron.schedule('0 * * * *', async () => {
            await this.processReminders();
        }, { timezone: 'America/Sao_Paulo' });

        logger.info('🔔 Scheduler de lembretes iniciado (executa de hora em hora)');
    }

    stop(): void {
        this.task?.stop();
        logger.info('🔕 Scheduler de lembretes parado');
    }

    async processReminders(): Promise<void> {
        try {
            // Janela: sessões que ocorrem entre 23h e 25h a partir de agora (garante cobertura de 1 execução/hora)
            const now = new Date();
            const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
            const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);

            const appointments = await this.repository.findUpcomingAppointments(windowStart, windowEnd);

            if (appointments.length === 0) return;

            logger.info({ count: appointments.length }, '🔔 Processando lembretes de agendamentos');

            for (const appointment of appointments) {
                await this.sendReminder(appointment);
            }
        } catch (err) {
            logger.error({ err }, 'Erro ao processar lembretes de agendamentos');
        }
    }

    private async sendReminder(appointment: UpcomingAppointment): Promise<void> {
        const message = buildReminderMessage(appointment);

        if (!appointment.patientPhone) {
            logger.warn({
                appointmentId: appointment.appointmentId,
                patientName: appointment.patientName
            }, '⚠️ Paciente sem telefone cadastrado — lembrete não enviado');
            return;
        }

        // Tentativa 1: Envio direto via WhatsApp (Baileys)
        if (this.whatsappSessionManager) {
            try {
                const client = await this.whatsappSessionManager.getSession(appointment.tenantId);
                if (client && client.isConnected()) {
                    await client.sendMessage(appointment.patientPhone, message);
                    logger.info({
                        appointmentId: appointment.appointmentId,
                        tenantId: appointment.tenantId,
                        patientName: appointment.patientName,
                        scheduledAt: appointment.scheduledAt
                    }, '✅ Lembrete enviado via WhatsApp');
                    return; // Sucesso — não precisa do fallback
                } else {
                    logger.warn({
                        appointmentId: appointment.appointmentId,
                        tenantId: appointment.tenantId
                    }, '⚠️ Sessão WhatsApp não conectada para este tenant — usando fallback');
                }
            } catch (err) {
                logger.error({ err, appointmentId: appointment.appointmentId }, 'Erro ao enviar lembrete via WhatsApp — usando fallback');
            }
        }

        // Fallback: loga o link para envio manual ou via webhook externo
        const whatsappLink = buildWhatsAppLink(appointment.patientPhone, message);
        logger.info({
            appointmentId: appointment.appointmentId,
            tenantId: appointment.tenantId,
            patientName: appointment.patientName,
            scheduledAt: appointment.scheduledAt,
            whatsappLink
        }, '📱 Lembrete WhatsApp gerado (fallback — conecte o WhatsApp para envio automático)');

        await this.dispatchToWebhook(appointment, message, whatsappLink);
    }

    private async dispatchToWebhook(
        appointment: UpcomingAppointment,
        message: string,
        whatsappLink: string
    ): Promise<void> {
        const webhookUrl = process.env.REMINDER_WEBHOOK_URL;
        if (!webhookUrl) return;

        try {
            const payload = {
                event: 'appointment.reminder',
                appointmentId: appointment.appointmentId,
                tenantId: appointment.tenantId,
                patientId: appointment.patientId,
                patientName: appointment.patientName,
                patientPhone: appointment.patientPhone,
                scheduledAt: appointment.scheduledAt.toISOString(),
                message,
                whatsappLink
            };

            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(5000)
            });

            if (!response.ok) {
                logger.warn({ status: response.status, webhookUrl }, 'Webhook de lembrete retornou status não-OK');
            }
        } catch (err) {
            logger.error({ err, webhookUrl }, 'Falha ao enviar webhook de lembrete');
        }
    }
}
