import cron from 'node-cron';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';
import { WhatsappSessionManager } from '@antigravity/whatsapp-core';
import { WhatsappCloudClient } from '../whatsappCloud/WhatsappCloudClient';
import { resolveWhatsAppProvider } from '../whatsappCloud/WhatsappCloudConfig';
import { logger } from '../logger';

export class BillingReminderScheduler {
    // private readonly logger = new Logger('BillingReminderScheduler');

    constructor(
        private readonly repository: IPsychotherapyRepository,
        private readonly whatsappSessionManager?: WhatsappSessionManager,
        private readonly whatsappCloudClient?: WhatsappCloudClient
    ) {}

    public start(): void {
        // Roda todos os dias às 09:00 no fuso de SP
        cron.schedule('0 9 * * *', async () => {
            logger.info('Iniciando job de cobrança automática...');
            await this.processReminders();
        }, {
            timezone: "America/Sao_Paulo"
        });
    }

    private async processReminders(): Promise<void> {
        try {
            // Verifica se hoje é dia 01
            const now = new Date();
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: 'America/Sao_Paulo',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
            const parts = formatter.formatToParts(now);
            const dayStr = parts.find(p => p.type === 'day')?.value;

            if (dayStr !== '01') {
                logger.info(`Hoje não é dia 01 (é dia ${dayStr}). Job finalizado.`);
                return;
            }

            // Calcula o mês anterior (YYYY-MM)
            const yearStr = parts.find(p => p.type === 'year')?.value;
            const monthStr = parts.find(p => p.type === 'month')?.value;
            
            if (!yearStr || !monthStr) {
                logger.error('Falha ao extrair ano/mês da data atual.');
                return;
            }

            let yearNum = parseInt(yearStr, 10);
            let monthNum = parseInt(monthStr, 10);

            monthNum -= 1;
            if (monthNum === 0) {
                monthNum = 12;
                yearNum -= 1;
            }

            const previousMonthStr = `${yearNum}-${monthNum.toString().padStart(2, '0')}`;
            logger.info(`Mês alvo para cobrança: ${previousMonthStr}`);

            // 1. Pega todas as clínicas que habilitaram cobrança automática
            const tenants = await this.repository.listTenantsWithAutomaticBilling();
            if (tenants.length === 0) {
                logger.info('Nenhuma clínica com cobrança automática habilitada.');
                return;
            }

            for (const tenant of tenants) {
                try {
                    await this.processTenant(tenant.id, previousMonthStr);
                } catch (tenantError: any) {
                    logger.error(`Erro ao processar cobranças do tenant ${tenant.id}: ${tenantError.message}`);
                }
            }

        } catch (error: any) {
            logger.error(`Erro no job de cobrança: ${error.message}`);
        }
    }

    private async processTenant(tenantId: string, month: string): Promise<void> {
        // Pega registros mensais
        const records = await this.repository.listMonthlyRecords(tenantId, month);
        
        let sentCount = 0;
        const provider = resolveWhatsAppProvider();

        for (const record of records) {
            // Apenas registros que não estão pagos
            if (record.paymentStatus === 'paid') continue;
            
            // Apenas se tiver valor pendente > 0
            if (record.pendingAmountCents <= 0) continue;

            if (!record.patientId) continue;

            const patient = await this.repository.findActivePatientById(tenantId, record.patientId);
            if (!patient) continue;

            // Filtra se o paciente deu opt-out ou paga por sessão
            if (patient.automaticBillingOptOut) continue;
            if (patient.paymentType === 'per_session') continue;
            // Só envia por whatsapp (se não tiver fone, pula)
            if (!patient.phone) continue;

            // Verifica se já mandou
            const alreadySent = await this.repository.hasSentBillingReminder(tenantId, patient.id, month);
            if (alreadySent) continue;

            // Envia WhatsApp
            const valorReais = (record.pendingAmountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            
            // Mês por extenso
            const [yearStr, monthStr] = month.split('-');
            const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
            const mesExtenso = monthNames[parseInt(monthStr, 10) - 1];

            const message = `Olá ${patient.name || patient.fullName || 'Paciente'},\n\nA sua fatura de sessões referente a ${mesExtenso}/${yearStr} fechou em ${valorReais}.\n\nVocê pode realizar o pagamento via Pix. Qualquer dúvida, estou à disposição!`;

            try {
                if (provider === 'meta_cloud' && this.whatsappCloudClient) {
                    const outcome = await this.whatsappCloudClient.sendTemplateMessage(
                        patient.phone,
                        'billing_reminder',
                        'en_US', // Template foi aprovado como English na Meta
                        [{ type: 'body', values: [patient.name || patient.fullName || 'Paciente', `${mesExtenso}/${yearStr}`, valorReais] }]
                    );
                    
                    if (outcome.kind !== 'accepted') {
                        throw new Error(`Meta API rejeitou o Template (Status: ${outcome.kind})`);
                    }
                } else if (provider === 'baileys' && this.whatsappSessionManager) {
                    const session = await this.whatsappSessionManager.getSession(tenantId);
                    if (session && session.isConnected()) {
                        await session.sendMessage(`${patient.phone}`, message);
                    } else {
                        throw new Error('Sessão do Baileys não conectada.');
                    }
                } else {
                    throw new Error(`Provedor WhatsApp '${provider}' não suportado ou instâncias não fornecidas.`);
                }
                
                await this.repository.logBillingReminder(tenantId, patient.id, month);
                sentCount++;
                logger.info(`Cobrança de ${month} enviada para o paciente ${patient.id} do tenant ${tenantId}`);
            } catch (sendError: any) {
                logger.error(`Falha ao enviar whatsapp de cobrança para ${patient.id}: ${sendError.message}`);
            }
        }

        logger.info(`Tenant ${tenantId}: enviadas ${sentCount} mensagens de cobrança para ${month}.`);
    }
}
