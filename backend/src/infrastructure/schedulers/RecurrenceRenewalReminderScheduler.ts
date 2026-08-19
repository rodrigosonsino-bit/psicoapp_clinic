import cron from 'node-cron';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';
import { WhatsappSessionManager } from '@antigravity/whatsapp-core';
import { WhatsappCloudClient } from '../whatsappCloud/WhatsappCloudClient';
import { resolveWhatsAppProvider } from '../whatsappCloud/WhatsappCloudConfig';
import { logger } from '../logger';

const RENEWAL_WINDOW_DAYS = 7;

/**
 * Avisa o terapeuta (não o paciente) quando uma série recorrente criada com o
 * cap de 3 meses (ver SavePsychotherapyAppointmentUseCase) está a até
 * RENEWAL_WINDOW_DAYS de vencer, via WhatsApp (admin_mirror_phone) e via a
 * fila que o painel consulta em GET /psychotherapy/recurrence-renewals/pending.
 *
 * Idempotência: createRecurrenceRenewalNotice usa UNIQUE(appointment_id,
 * recurrence_end_date) — só a primeira execução dentro da janela de 7 dias
 * cria a linha e dispara o WhatsApp; as execuções seguintes do mesmo dia (ou
 * dos dias seguintes até o vencimento) encontram a linha já criada e pulam o
 * envio, mas a linha continua disponível pro card do painel até ser resolvida.
 */
export class RecurrenceRenewalReminderScheduler {
    constructor(
        private readonly repository: IPsychotherapyRepository,
        private readonly whatsappSessionManager?: WhatsappSessionManager,
        private readonly whatsappCloudClient?: WhatsappCloudClient
    ) {}

    public start(): void {
        // Roda todos os dias às 08:30 no fuso de SP — antes do horário comercial,
        // horário distinto do job de cobrança (09:00) pra não competir por recursos.
        cron.schedule('30 8 * * *', async () => {
            logger.info('[RecurrenceRenewalReminder] Iniciando verificação de séries vencendo...');
            await this.processReminders();
        }, {
            timezone: 'America/Sao_Paulo'
        });
    }

    public async runOnce(): Promise<void> {
        await this.processReminders();
    }

    private async processReminders(): Promise<void> {
        try {
            const { from, to } = this.getWindow();
            const tenants = await this.repository.listAllTenants();

            for (const tenant of tenants) {
                try {
                    await this.processTenant(tenant.id, from, to, tenant.adminMirrorPhone ?? null);
                } catch (tenantError: any) {
                    logger.error(`[RecurrenceRenewalReminder] Erro ao processar tenant ${tenant.id}: ${tenantError.message}`);
                }
            }
        } catch (error: any) {
            logger.error(`[RecurrenceRenewalReminder] Erro no job: ${error.message}`);
        }
    }

    private getWindow(): { from: Date; to: Date } {
        const now = new Date();
        const from = new Date(now);
        from.setHours(0, 0, 0, 0);
        const to = new Date(from);
        to.setDate(to.getDate() + RENEWAL_WINDOW_DAYS);
        return { from, to };
    }

    private async processTenant(tenantId: string, from: Date, to: Date, adminMirrorPhone: string | null): Promise<void> {
        const expiring = await this.repository.listExpiringRecurrenceRoots(tenantId, from, to);
        if (expiring.length === 0) return;

        const provider = resolveWhatsAppProvider();

        for (const { appointment, patientName } of expiring) {
            if (!appointment.recurrenceEndDate) continue;

            const noticeId = await this.repository.createRecurrenceRenewalNotice(
                tenantId, appointment.id, appointment.patientId, appointment.recurrenceEndDate
            );
            // null = já avisado nesse ciclo (mesma série + mesma recurrence_end_date) — não reenvia.
            if (!noticeId) continue;

            logger.info(`[RecurrenceRenewalReminder] Série de ${patientName} (tenant ${tenantId}) vence em ${appointment.recurrenceEndDate.toISOString().slice(0, 10)}.`);

            if (!adminMirrorPhone) continue;

            const dataFormatada = appointment.recurrenceEndDate.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
            const message = `⏰ A série de sessões recorrentes de ${patientName} vence em ${dataFormatada}. Quer renovar por mais 1, 2 ou 3 meses? Acesse o painel para renovar.`;

            try {
                if (provider === 'meta_cloud' && this.whatsappCloudClient) {
                    // Sem template aprovado pra esse conteúdo — freeform só entrega dentro da
                    // janela de 24h de atendimento do WhatsApp Business (o terapeuta precisa ter
                    // mandado mensagem pro próprio número business recentemente). Fora da janela,
                    // a Meta rejeita silenciosamente; o aviso continua disponível no painel.
                    await this.whatsappCloudClient.sendFreeformText(adminMirrorPhone, message);
                } else if (provider === 'baileys' && this.whatsappSessionManager) {
                    const session = await this.whatsappSessionManager.getSession(tenantId);
                    if (session && session.isConnected()) {
                        await session.sendMessage(adminMirrorPhone, message);
                    }
                }
            } catch (sendError: any) {
                logger.warn(`[RecurrenceRenewalReminder] Falha ao enviar WhatsApp de renovação (tenant ${tenantId}, agendamento ${appointment.id}): ${sendError.message}. Aviso segue disponível no painel.`);
            }
        }
    }
}
