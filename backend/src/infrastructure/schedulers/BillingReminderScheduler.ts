import cron from 'node-cron';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';
import { WhatsappSessionManager } from '@antigravity/whatsapp-core';
import { WhatsappCloudClient } from '../whatsappCloud/WhatsappCloudClient';
import { resolveWhatsAppProvider } from '../whatsappCloud/WhatsappCloudConfig';
import { logger } from '../logger';

export interface BillingReminderCandidate {
    tenantId: string;
    patientId: string;
    patientName: string;
    phoneMasked: string;
    month: string;
    amountCents: number;
    overdueMonthsCount: number;
    overdueTotalCents: number;
    sent: boolean;
    error?: string;
}

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

    /**
     * Dispara a rotina de cobrança manualmente, fora do agendamento normal do cron
     * (que só age no dia 01). Reaproveita exatamente a mesma lógica de seleção e envio
     * de processTenant. Com dryRun=true, não envia WhatsApp nem grava
     * logBillingReminder — só retorna os candidatos que seriam processados.
     */
    public async runOnce(opts: { dryRun: boolean }): Promise<BillingReminderCandidate[]> {
        const month = this.getPreviousMonthStr();
        logger.info(`[runOnce] Mês alvo: ${month} (dryRun=${opts.dryRun})`);

        const tenants = await this.repository.listTenantsWithAutomaticBilling();
        if (tenants.length === 0) {
            logger.info('[runOnce] Nenhuma clínica com cobrança automática habilitada.');
            return [];
        }

        const results: BillingReminderCandidate[] = [];
        for (const tenant of tenants) {
            try {
                const tenantResults = await this.processTenant(tenant.id, month, opts.dryRun, this.resolveAdminMirrorPhone(tenant));
                results.push(...tenantResults);
            } catch (tenantError: any) {
                logger.error(`[runOnce] Erro ao processar tenant ${tenant.id}: ${tenantError.message}`);
            }
        }
        return results;
    }

    /**
     * Telefone de espelho: prioriza o campo por-tenant (admin_mirror_phone). Fallback
     * temporário para as env vars antigas (ADMIN_WHATSAPP_MIRROR_NUMBER/_TENANT_ID),
     * enquanto o rollout do campo por-tenant não estiver completo em todos os ambientes —
     * remover esse fallback e as env vars assim que confirmado que o campo está populado.
     */
    private resolveAdminMirrorPhone(tenant: { id: string; adminMirrorPhone: string | null }): string | null {
        if (tenant.adminMirrorPhone) return tenant.adminMirrorPhone;
        const legacyNumber = process.env.ADMIN_WHATSAPP_MIRROR_NUMBER;
        const legacyTenantId = process.env.ADMIN_WHATSAPP_MIRROR_TENANT_ID;
        return legacyNumber && legacyTenantId === tenant.id ? legacyNumber : null;
    }

    private getPreviousMonthStr(): string {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Sao_Paulo',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
        const parts = formatter.formatToParts(now);
        const yearStr = parts.find(p => p.type === 'year')!.value;
        const monthStr = parts.find(p => p.type === 'month')!.value;

        let yearNum = parseInt(yearStr, 10);
        let monthNum = parseInt(monthStr, 10);

        monthNum -= 1;
        if (monthNum === 0) {
            monthNum = 12;
            yearNum -= 1;
        }

        return `${yearNum}-${monthNum.toString().padStart(2, '0')}`;
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

            const previousMonthStr = this.getPreviousMonthStr();
            logger.info(`Mês alvo para cobrança: ${previousMonthStr}`);

            // 1. Pega todas as clínicas que habilitaram cobrança automática
            const tenants = await this.repository.listTenantsWithAutomaticBilling();
            if (tenants.length === 0) {
                logger.info('Nenhuma clínica com cobrança automática habilitada.');
                return;
            }

            for (const tenant of tenants) {
                try {
                    await this.processTenant(tenant.id, previousMonthStr, false, this.resolveAdminMirrorPhone(tenant));
                } catch (tenantError: any) {
                    logger.error(`Erro ao processar cobranças do tenant ${tenant.id}: ${tenantError.message}`);
                }
            }

        } catch (error: any) {
            logger.error(`Erro no job de cobrança: ${error.message}`);
        }
    }

    /**
     * Soma o saldo pendente dos registros mensais do paciente anteriores a `month`.
     * Fonte de verdade é pendingAmountCents (o mesmo valor computado usado pela cobrança
     * em si) — não paymentStatus, que é um campo manual e pode ficar desalinhado (ex:
     * marcado 'paid' por engano com saldo ainda positivo). Quando isso acontece, logamos
     * um warning em vez de mascarar a dívida.
     * Best-effort: falha nessa consulta não deve derrubar o envio da cobrança do mês
     * corrente para o paciente — se falhar, retorna zero e loga o erro (o alerta é um
     * complemento informativo, a cobrança em si não depende dele).
     */
    private async getOverdueSummary(tenantId: string, patientId: string, month: string): Promise<{ overdueMonthsCount: number; overdueTotalCents: number }> {
        try {
            const priorRecords = await this.repository.listPatientMonthlyRecordsBefore(tenantId, patientId, month);
            const overdueRecords = priorRecords.filter(r => r.pendingAmountCents > 0);

            for (const r of overdueRecords) {
                if (r.paymentStatus === 'paid') {
                    logger.warn(`Inconsistência: registro ${r.month} do paciente ${patientId} está paymentStatus='paid' mas pendingAmountCents=${r.pendingAmountCents}.`);
                }
            }

            return {
                overdueMonthsCount: overdueRecords.length,
                overdueTotalCents: overdueRecords.reduce((sum, r) => sum + r.pendingAmountCents, 0)
            };
        } catch (error: any) {
            logger.warn(`Falha ao calcular inadimplência acumulada do paciente ${patientId}: ${error.message}. Cobrança do mês corrente segue sem o alerta.`);
            return { overdueMonthsCount: 0, overdueTotalCents: 0 };
        }
    }

    private async processTenant(tenantId: string, month: string, dryRun: boolean, adminMirrorPhone: string | null): Promise<BillingReminderCandidate[]> {
        // Pega registros mensais
        const records = await this.repository.listMonthlyRecords(tenantId, month);

        let sentCount = 0;
        const provider = resolveWhatsAppProvider();
        const results: BillingReminderCandidate[] = [];

        for (const record of records) {
            // Apenas registros que não estão pagos
            if (record.paymentStatus === 'paid') continue;

            // Apenas se tiver valor pendente > 0
            if (record.pendingAmountCents <= 0) continue;

            if (!record.patientId) continue;

            const patient = await this.repository.findActivePatientById(tenantId, record.patientId);
            if (!patient) continue;

            // Filtra se o paciente deu opt-out
            if (patient.automaticBillingOptOut) continue;
            // Só envia por whatsapp (se não tiver fone, pula)
            if (!patient.phone) continue;

            // Verifica se já mandou
            const alreadySent = await this.repository.hasSentBillingReminder(tenantId, patient.id, month);
            if (alreadySent) continue;

            const patientName = patient.name || patient.fullName || 'Paciente';
            const phoneMasked = patient.phone.length > 4
                ? `${'*'.repeat(patient.phone.length - 4)}${patient.phone.slice(-4)}`
                : patient.phone;

            // Soma o saldo pendente de meses anteriores já fechados (inadimplência
            // acumulada), para alertar o paciente mesmo sem cobrar automaticamente
            // esse valor — a cobrança em si continua isolada por mês (ver processTenant).
            const { overdueMonthsCount, overdueTotalCents } = await this.getOverdueSummary(tenantId, patient.id, month);

            if (dryRun) {
                results.push({
                    tenantId,
                    patientId: patient.id,
                    patientName,
                    phoneMasked,
                    month,
                    amountCents: record.pendingAmountCents,
                    overdueMonthsCount,
                    overdueTotalCents,
                    sent: false
                });
                continue;
            }

            // Envia WhatsApp
            const valorReais = (record.pendingAmountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

            // Mês por extenso
            const [yearStr, monthStr] = month.split('-');
            const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
            const mesExtenso = monthNames[parseInt(monthStr, 10) - 1];

            let message = `Olá ${patientName},\n\nA sua fatura de sessões referente a ${mesExtenso}/${yearStr} fechou em ${valorReais}.\n\nVocê pode realizar o pagamento via Pix. Qualquer dúvida, estou à disposição!`;

            // Variável "valor" enviada ao template da Meta: quando há inadimplência
            // acumulada, o alerta é anexado nessa mesma variável (numa única linha, sem
            // quebras de linha) porque o template billing_reminder já está aprovado na Meta
            // com exatamente 3 variáveis fixas — adicionar uma 4ª variável ou mudar a
            // estrutura do corpo exigiria resubmeter o template para reaprovação manual.
            // No canal Baileys (texto livre, sem template) o alerta vai em parágrafo à parte
            // em `message`, que é mais legível.
            let valorTemplateParam = valorReais;

            if (overdueTotalCents > 0) {
                const overdueReais = (overdueTotalCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                const mesesLabel = overdueMonthsCount === 1 ? 'mês anterior' : `${overdueMonthsCount} meses anteriores`;
                message += `\n\n⚠️ Este valor é só de ${mesExtenso}/${yearStr}. Além dele, consta separadamente ${overdueReais} em aberto de ${mesesLabel}. Podemos combinar a regularização?`;
                // Redação explícita de que o valor extra NÃO está somado ao valor principal
                // da variável — evita o paciente ler "R$ X + R$ Y" como cobrança de R$ X+Y.
                valorTemplateParam = `${valorReais} (aviso: há também ${overdueReais} pendente de ${mesesLabel}, valor separado, não incluído nesta fatura)`;
            }

            try {
                if (provider === 'meta_cloud' && this.whatsappCloudClient) {
                    const outcome = await this.whatsappCloudClient.sendTemplateMessage(
                        patient.phone,
                        'billing_reminder',
                        'en', // Template está aprovado na Meta como idioma "en" (não "en_US") — confirmado via Graph API /message_templates
                        [{ type: 'body', values: [patientName, `${mesExtenso}/${yearStr}`, valorTemplateParam] }]
                    );

                    if (outcome.kind !== 'accepted') {
                        const detail = (outcome as any).errorCode || (outcome as any).errorMessage
                            ? ` — código=${(outcome as any).errorCode} msg=${(outcome as any).errorMessage}`
                            : '';
                        throw new Error(`Meta API rejeitou o Template (Status: ${outcome.kind}${detail})`);
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

                // Registra ANTES de contar como sucesso, para minimizar a janela entre
                // "mensagem aceita pela Meta" e "marcado como enviado" — se o registro
                // falhar aqui, preferimos arriscar reprocessar (idempotente via
                // hasSentBillingReminder na próxima tentativa) a nunca marcar como enviado.
                await this.repository.logBillingReminder(tenantId, patient.id, month);
                sentCount++;
                logger.info(`Cobrança de ${month} enviada para o paciente ${patient.id} do tenant ${tenantId}`);

                // Espelha a cobrança para o WhatsApp do dono da clínica (configurável por
                // tenant em admin_mirror_phone), para visibilidade de que o envio realmente
                // aconteceu (hoje não há tela no app pra isso). O valor já vem resolvido por
                // tenant específico (ver resolveAdminMirrorPhone) — não há risco de vazar
                // dados de um tenant para o admin de outro.
                if (adminMirrorPhone && provider === 'meta_cloud' && this.whatsappCloudClient) {
                    try {
                        await this.whatsappCloudClient.sendTemplateMessage(
                            adminMirrorPhone,
                            'billing_reminder',
                            'en',
                            [{ type: 'body', values: [patientName, `${mesExtenso}/${yearStr}`, valorTemplateParam] }]
                        );
                    } catch (mirrorError: any) {
                        // Best-effort: falha no espelho não deve afetar o envio original,
                        // que já aconteceu e já foi registrado acima.
                        logger.warn(`Falha ao espelhar cobrança de ${patient.id} para o admin: ${mirrorError.message}`);
                    }
                }

                results.push({
                    tenantId,
                    patientId: patient.id,
                    patientName,
                    phoneMasked,
                    month,
                    amountCents: record.pendingAmountCents,
                    overdueMonthsCount,
                    overdueTotalCents,
                    sent: true
                });
            } catch (sendError: any) {
                logger.error(`Falha ao enviar whatsapp de cobrança para ${patient.id}: ${sendError.message}`);
                results.push({
                    tenantId,
                    patientId: patient.id,
                    patientName,
                    phoneMasked,
                    month,
                    amountCents: record.pendingAmountCents,
                    overdueMonthsCount,
                    overdueTotalCents,
                    sent: false,
                    error: sendError.message
                });
            }
        }

        logger.info(`Tenant ${tenantId}: enviadas ${sentCount} mensagens de cobrança para ${month}.`);
        return results;
    }
}
