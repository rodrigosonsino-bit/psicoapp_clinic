import cron from 'node-cron';
import { IMessageRepository } from '../../domain/repositories/IMessageRepository';
import { IMessageSchedulerService } from '../../application/services/IMessageSchedulerService';
import { WhatsappSessionManager } from '../whatsapp/WhatsappSessionManager';
import { logger } from '../logger/logger';

/**
 * Servidor de Reconciliacao (Cron Job)
 * Finalidade 1: Garantir que nenhuma mensagem 'pending' no banco seja esquecida,
 * mesmo que o Redis (BullMQ) tenha sofrido uma queda momentanea.
 *
 * Finalidade 2: Reagendar automaticamente mensagens 'failed' recentes (últimas 2h)
 * quando o WhatsApp do tenant estiver reconectado — corrigindo falhas causadas por
 * desconexão temporária do socket no momento do disparo.
 */
export class ReconciliationJob {
    constructor(
        private readonly messageRepository: IMessageRepository,
        private readonly schedulerService: IMessageSchedulerService,
        private readonly sessionManager?: WhatsappSessionManager
    ) {}

    public start() {
        // Roda a cada 5 minutos
        cron.schedule('*/5 * * * *', async () => {
            logger.info('⚙️ Iniciando ciclo de reconciliacao de mensagens pendentes...');
            
            try {
                // --- PARTE 1: Reconciliar mensagens 'pending' que saíram do Redis ---
                const messagesToReconcile = await this.messageRepository.findAllPending();

                if (messagesToReconcile.length === 0) {
                    logger.info('✅ Nenhuma mensagem pendente encontrada para reconciliar.');
                } else {
                    logger.warn(`⚠️ Forçando re-injeção de ${messagesToReconcile.length} mensagens na fila do Redis para consistência.`);
                    for (const message of messagesToReconcile) {
                        const delayMs = Math.max(0, message.sendAt.getTime() - Date.now());
                        // O agendador já usa o message.id como jobId do BullMQ, o que evita duplicados.
                        await this.schedulerService.schedule(message, delayMs);
                    }
                    logger.info('✨ Reconciliacao de pendentes concluída com sucesso.');
                }

                // --- PARTE 2: Reagendar mensagens 'failed' recentes se o WhatsApp reconectou ---
                if (!this.sessionManager) return;

                const recentFailed = await this.messageRepository.findRecentFailed(2);
                if (recentFailed.length === 0) return;

                logger.info(`🔄 Verificando ${recentFailed.length} mensagem(ns) 'failed' recente(s) para possível reagendamento...`);

                // Agrupar por tenant para checar conexão uma única vez por tenant
                const byTenant = new Map<string, typeof recentFailed>();
                for (const msg of recentFailed) {
                    if (!byTenant.has(msg.userId)) byTenant.set(msg.userId, []);
                    byTenant.get(msg.userId)!.push(msg);
                }

                for (const [tenantId, failedMessages] of byTenant.entries()) {
                    const session = await this.sessionManager.getSession(tenantId);
                    if (!session || !session.isConnected()) {
                        logger.debug({ tenantId }, 'WhatsApp ainda desconectado. Mensagens failed aguardam reconexão.');
                        continue;
                    }

                    logger.info({ tenantId, count: failedMessages.length }, '✅ WhatsApp reconectado! Reagendando mensagens failed recentes...');

                    for (const msg of failedMessages) {
                        try {
                            // Reativar status para 'pending' e colocar na fila imediatamente
                            await this.messageRepository.updateStatus(msg.id!, 'pending');
                            await this.schedulerService.schedule(msg, 0); // delay 0 = disparo imediato
                            logger.info({ messageId: msg.id, tenantId }, '📬 Mensagem failed reagendada com sucesso.');
                        } catch (schedErr) {
                            logger.error({ err: schedErr, messageId: msg.id }, 'Falha ao reagendar mensagem failed.');
                        }
                    }
                }
            } catch (error) {
                logger.error({ err: error }, 'Falha grave durante o ciclo de reconciliacao do Cron.');
            }
        }, {
            timezone: 'America/Sao_Paulo'
        });
        
        logger.info('🛰️ Cron Job de Reconciliacao ATIVADO (Intervalo: 5 minutos | Modo: pending + auto-retry de failed).');
    }
}
