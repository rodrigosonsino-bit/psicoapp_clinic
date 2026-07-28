import * as cron from 'node-cron';
import { IPsychotherapyRepository, UpcomingAppointment } from '../../domain/repositories/IPsychotherapyRepository';
import { logger } from '../logger';
import { WhatsappSessionManager } from '@antigravity/whatsapp-core';
import { EmailService } from '../services/EmailService';
import { WhatsappCloudClient } from '../whatsappCloud/WhatsappCloudClient';
import { resolveWhatsAppProvider } from '../whatsappCloud/WhatsappCloudConfig';
import { formatDateTimeBR } from './ReminderScheduler';

const MEET_LINK_TEMPLATE = 
    `Olá, {nome}! 🕒\n\n` +
    `Sua sessão online começará em breve.\n\n` +
    `Acesse a sala de vídeo através do link abaixo:\n` +
    `🎥 {link}\n\n` +
    `Bom atendimento!`;

export class MeetLinkScheduler {
    private task: ReturnType<typeof cron.schedule> | null = null;
    private readonly emailService = new EmailService();

    constructor(
        private readonly repository: IPsychotherapyRepository,
        private readonly whatsappSessionManager?: WhatsappSessionManager,
        private readonly whatsappCloudClient?: WhatsappCloudClient
    ) {}

    /** Inicia o cron — executa a cada 5 minutos. */
    start(): void {
        this.task = cron.schedule('*/5 * * * *', async () => {
            await this.processMeetLinks();
        }, { timezone: 'America/Sao_Paulo' });

        logger.info('🔔 Scheduler de Links do Meet iniciado (executa a cada 5 min)');
    }

    stop(): void {
        this.task?.stop();
        logger.info('🔕 Scheduler de Links do Meet parado');
    }

    async processMeetLinks(): Promise<void> {
        try {
            // Janela de varredura: de agora até daqui a 10 minutos
            // Qualquer sessão agendada pra começar nesses 10 min será processada.
            const now = new Date();
            const windowEnd = new Date(now.getTime() + 10 * 60 * 1000);

            const appointments = await this.repository.findUpcomingAppointments(now, windowEnd);
            
            // Filtrar apenas online e com link gerado
            const onlineWithLink = appointments.filter(a => a.modality === 'online' && a.googleMeetLink);

            if (onlineWithLink.length > 0) {
                logger.info({ count: onlineWithLink.length }, '🔗 Processando lembretes JIT (Just-in-Time) do Google Meet');
                
                for (const appt of onlineWithLink) {
                    await this.dispatchMeetLink(appt);
                }
            }
        } catch (err) {
            logger.error({ err }, 'Erro ao processar lembretes JIT do Google Meet');
        }
    }

    private async dispatchMeetLink(appt: UpcomingAppointment): Promise<void> {
        const channel = appt.reminderChannel;
        const needsWhatsApp = channel === 'whatsapp' || channel === 'both';
        const needsEmail    = channel === 'email'    || channel === 'both';

        if (needsWhatsApp) {
            const alreadySent = await this.repository.hasReminderBeenSent(appt.appointmentId, 'meet_link_whatsapp' as any);
            if (!alreadySent && appt.patientPhone) {
                await this.sendViaWhatsApp(appt);
            }
        }

        if (needsEmail) {
            const alreadySent = await this.repository.hasReminderBeenSent(appt.appointmentId, 'meet_link_email' as any);
            if (!alreadySent && appt.patientEmail) {
                await this.sendViaEmail(appt);
            }
        }
    }

    private async sendViaWhatsApp(appt: UpcomingAppointment): Promise<void> {
        const provider = resolveWhatsAppProvider();

        if (provider === 'disabled') {
            return; // Silently abort if disabled
        }

        const message = MEET_LINK_TEMPLATE
            .replace(/{nome}/g, appt.patientName)
            .replace(/{link}/g, appt.googleMeetLink!);

        try {
            if (provider === 'meta_cloud' && this.whatsappCloudClient) {
                await this.whatsappCloudClient.sendFreeformText(appt.patientPhone!, message);
                await this.repository.markReminderSent(appt.appointmentId, appt.tenantId, 'meet_link_whatsapp' as any, 'success', undefined, { provider: 'meta_cloud', retryEligible: false });
            } else if (provider === 'baileys' && this.whatsappSessionManager) {
                const session = await this.whatsappSessionManager.getSession(appt.tenantId);
                if (!session || !session.isConnected()) {
                    logger.warn({ appointmentId: appt.appointmentId, tenantId: appt.tenantId }, '⚠️ Sessão Baileys desconectada - não foi possível enviar Meet Link');
                    return; // Fail gracefully so it can be picked up if reconnected in the 10 min window
                }
                await session.sendMessage(appt.patientPhone!, message);
                await this.repository.markReminderSent(appt.appointmentId, appt.tenantId, 'meet_link_whatsapp' as any, 'success', undefined, { provider: 'baileys', retryEligible: false });
            }
            logger.info({ appointmentId: appt.appointmentId, patientName: appt.patientName }, '✅ Link do Meet enviado por WhatsApp');

            // Encaminhar para o terapeuta
            const therapistPhone = '5518996994225';
            const forwardMessage = `🔔 Lembrete do Meet JIT enviado para a paciente ${appt.patientName}.\n🎥 Sala: ${appt.googleMeetLink}`;
            if (provider === 'meta_cloud' && this.whatsappCloudClient) {
                await this.whatsappCloudClient.sendFreeformText(therapistPhone, forwardMessage).catch(err => logger.warn({ err }, '⚠️ Falha ao encaminhar link para o terapeuta (Cloud)'));
            } else if (provider === 'baileys' && this.whatsappSessionManager) {
                const session = await this.whatsappSessionManager.getSession(appt.tenantId);
                if (session && session.isConnected()) {
                    await session.sendMessage(therapistPhone, forwardMessage).catch(err => logger.warn({ err }, '⚠️ Falha ao encaminhar link para o terapeuta (Baileys)'));
                }
            }
        } catch (err) {
            logger.error({ err, appointmentId: appt.appointmentId }, '❌ Erro ao enviar Link do Meet por WhatsApp');
            // Log as failed
            const errorMsg = err instanceof Error ? err.message : String(err);
            await this.repository.markReminderSent(appt.appointmentId, appt.tenantId, 'meet_link_whatsapp' as any, 'failed', errorMsg, { retryEligible: false });
        }
    }

    private async sendViaEmail(appt: UpcomingAppointment): Promise<void> {
        try {
            await this.emailService.sendAppointmentReminder({
                to: appt.patientEmail!,
                patientName: appt.patientName,
                therapistName: appt.tenantName,
                scheduledAt: appt.scheduledAt,
                durationMinutes: appt.durationMinutes,
                modality: appt.modality,
                googleMeetLink: appt.googleMeetLink
            });

            await this.repository.markReminderSent(appt.appointmentId, appt.tenantId, 'meet_link_email' as any, 'success');
            logger.info({ appointmentId: appt.appointmentId, patientName: appt.patientName }, '📧 Link do Meet enviado por e-mail');
        } catch (err) {
            logger.error({ err, appointmentId: appt.appointmentId }, '❌ Erro ao enviar Link do Meet por e-mail');
            const errorMsg = err instanceof Error ? err.message : String(err);
            await this.repository.markReminderSent(appt.appointmentId, appt.tenantId, 'meet_link_email' as any, 'failed', errorMsg);
        }
    }
}
