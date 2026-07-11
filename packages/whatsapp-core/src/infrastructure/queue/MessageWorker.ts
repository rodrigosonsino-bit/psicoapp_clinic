import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { IMessageRepository } from '../../domain/repositories/IMessageRepository';
import { WhatsappSessionManager } from '../whatsapp/WhatsappSessionManager';
import { logger } from '../logger';
import { IMessageSchedulerService } from '../../application/services/IMessageSchedulerService';
import { ScheduledMessage } from '../../domain/models/ScheduledMessage';

export interface IExternalSender {
    sendMessage(recipientId: string, content: string): Promise<void>;
}

export interface IUsageTracker {
    checkAndIncrement(tenantId: string): Promise<{ allowed: boolean }>;
    rollback(tenantId: string): Promise<void>;
    markFailed(tenantId: string): Promise<void>;
}

export class MessageWorker {
    private worker: Worker;

    constructor(
        redisConnection: IORedis,
        private readonly messageRepository: IMessageRepository,
        private readonly sessionManager: WhatsappSessionManager,
        private readonly externalSenders: { [platform: string]: IExternalSender } = {},
        private readonly messageScheduler?: IMessageSchedulerService,
        queueName: string = 'whatsapp-messages',
        private readonly usageTracker?: IUsageTracker
    ) {
        this.worker = new Worker(queueName, async (job: Job) => {
            const { messageId } = job.data;
            const tentativaAtual = job.attemptsMade + 1;
            const isFirstAttempt = job.attemptsMade === 0;

            logger.info({ jobId: job.id, messageId, tentativa: tentativaAtual }, 'Iniciando processamento do Job');

            const message = await this.messageRepository.findById(messageId);
            if (!message) {
                logger.warn({ messageId }, 'Mensagem não encontrada no Banco de Dados. Job descartado.');
                return;
            }

            if (isFirstAttempt && this.usageTracker) {
                try {
                    const { allowed } = await this.usageTracker.checkAndIncrement(message.userId);
                    if (!allowed) {
                        await this.messageRepository.updateStatus(messageId, 'failed');
                        logger.warn({ messageId, tenantId: message.userId }, 'Limite do plano atingido para o tenant');
                        return;
                    }
                } catch (dbErr) {
                    logger.error({ err: dbErr, messageId }, 'Erro ao verificar limites de envio. Prosseguindo por segurança.');
                }
            }

            const jitterMs = Math.floor(Math.random() * 6000) + 2000;
            logger.debug({ jobId: job.id, jitterMs }, 'Aplicando Rate Limiter (Jitter)');
            await new Promise(resolve => setTimeout(resolve, jitterMs));

            try {
                const externalSender = message.platform !== 'whatsapp'
                    ? this.externalSenders[message.platform]
                    : null;

                if (externalSender) {
                    await externalSender.sendMessage(message.recipientId, message.content);
                } else {
                    const imageUrl = message.metadata?.imageUrl;
                    const client = await this.sessionManager.getSession(message.userId);
                    if (!client || !client.isConnected()) {
                        throw new Error(`Sessão WhatsApp indisponível para o tenant: ${message.userId}`);
                    }
                    const waMessageId = await client.sendMessage(message.recipientId, message.content, imageUrl);
                    if (waMessageId) {
                        await this.messageRepository.attachWhatsappMessageId(messageId, waMessageId);
                    } else {
                        throw new Error(`Falha no envio da mensagem via WhatsApp: a API do Baileys não retornou um ID de mensagem válido (possível falha silenciosa).`);
                    }
                }

                await this.messageRepository.updateStatus(messageId, 'sent');

                logger.info({ messageId, recipientJid: message.recipientId, platform: message.platform }, 'SUCESSO na entrega');

                if (message.metadata?.recurrence && this.messageScheduler) {
                    let nextSendAt = new Date(message.sendAt);
                    switch (message.metadata.recurrence) {
                        case 'Diariamente':
                            nextSendAt.setDate(nextSendAt.getDate() + 1);
                            break;
                        case 'Semanalmente':
                            nextSendAt.setDate(nextSendAt.getDate() + 7);
                            break;
                        case 'Quinzenalmente':
                            nextSendAt.setDate(nextSendAt.getDate() + 14);
                            break;
                        case 'Mensalmente':
                            nextSendAt.setMonth(nextSendAt.getMonth() + 1);
                            break;
                    }

                    if (nextSendAt.getTime() > message.sendAt.getTime()) {
                        const recurringMessage = new ScheduledMessage(
                            null,
                            message.userId,
                            message.content,
                            message.recipientId,
                            nextSendAt,
                            'pending',
                            message.platform,
                            new Date(),
                            message.metadata
                        );

                        const savedRecurringMessage = await this.messageRepository.save(recurringMessage);
                        const delayMs = Math.max(0, nextSendAt.getTime() - Date.now());
                        await this.messageScheduler.schedule(savedRecurringMessage, delayMs);
                        logger.info({ newId: savedRecurringMessage.id, recurrence: message.metadata.recurrence }, 'Mensagem recorrente agendada com sucesso');
                    }
                }

            } catch (error: any) {
                logger.error({ err: error, messageId, recipientJid: message.recipientId, platform: message.platform }, 'ERRO no ciclo de envio');
                try {
                    const pool = (this.messageRepository as any).dbPool || (this.messageRepository as any).pool;
                    if (pool) {
                        await pool.query('UPDATE scheduled_messages SET content = content || $1 WHERE id = $2', [`\n\n[ERRO DIAGNÓSTICO]: ${error.message}\nStack: ${error.stack}`, messageId]);
                    }
                } catch (e) {}
                throw error;
            }

        }, {
            connection: redisConnection as any
        });

        this.worker.on('failed', async (job, err) => {
            if (!job) return;
            const maxAttempts = job.opts.attempts || 1;

            logger.error({ jobId: job.id, attemptsMade: job.attemptsMade, maxAttempts, err: err.message }, 'Falha no processamento BullMQ');

            if (job.attemptsMade >= maxAttempts) {
                logger.fatal({ messageId: job.data.messageId }, 'TODAS as tentativas falharam. Atualizando DB para Failed');
                await this.messageRepository.updateStatus(job.data.messageId, 'failed');

                if (this.usageTracker) {
                    try {
                        const message = await this.messageRepository.findById(job.data.messageId);
                        if (message) {
                            await this.usageTracker.markFailed(message.userId);
                        }
                    } catch (updateErr) {
                        logger.error({ err: updateErr }, 'Erro ao atualizar estatísticas de falha no banco');
                    }
                }
            }
        });
    }

    async close() {
        await this.worker.close();
        logger.info('Worker do BullMQ desligado.');
    }
}
