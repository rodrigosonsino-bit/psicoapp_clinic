import { Worker, Job } from 'bullmq';
import { WhatsappSessionManager } from '@antigravity/whatsapp-core';
import { IBroadcastRepository } from '../../domain/repositories/IBroadcastRepository';
import { getBroadcastRedisConnection } from './redisConnection';
import { BROADCAST_QUEUE_NAME } from './BroadcastQueue';
import { logger } from '../logger';

const BROADCAST_INTERVAL_MS = Number(process.env.BROADCAST_INTERVAL_MS || 12000);
const BROADCAST_MAX_ATTEMPTS = Number(process.env.BROADCAST_MAX_ATTEMPTS || 5);
const BROADCAST_SENDING_LEASE_MS = Number(process.env.BROADCAST_SENDING_LEASE_MS || 120000);

/**
 * Worker dedicado do broadcast. Throttling real fica no `limiter` do BullMQ
 * (um envio por BROADCAST_INTERVAL_MS, concurrency = 1) — não apenas no
 * delay inicial do job, que não impede burst em retries/reinícios.
 */
export class BroadcastWorker {
    private worker: Worker | null = null;
    private leaseInterval: ReturnType<typeof setInterval> | null = null;

    constructor(
        private readonly repository: IBroadcastRepository,
        private readonly sessionManager: WhatsappSessionManager
    ) {}

    start(): void {
        this.worker = new Worker(
            BROADCAST_QUEUE_NAME,
            async (job: Job) => this.processJob(job),
            {
                connection: getBroadcastRedisConnection() as any,
                concurrency: 1,
                limiter: { max: 1, duration: BROADCAST_INTERVAL_MS }
            }
        );

        this.worker.on('failed', (job, err) => {
            logger.error({ jobId: job?.id, err }, 'Job de broadcast falhou inesperadamente.');
        });

        // Leases `sending` expiradas (crash do processo após claim) viram delivery_unknown.
        this.leaseInterval = setInterval(() => {
            this.repository.expireStaleLeases(BROADCAST_SENDING_LEASE_MS).catch(err => {
                logger.error({ err }, 'Erro ao expirar leases de envio de broadcast.');
            });
        }, BROADCAST_SENDING_LEASE_MS / 2);
    }

    async stop(): Promise<void> {
        if (this.leaseInterval) {
            clearInterval(this.leaseInterval);
            this.leaseInterval = null;
        }
        if (this.worker) {
            await this.worker.close();
            this.worker = null;
        }
    }

    private async processJob(job: Job): Promise<void> {
        const recipientId: string = job.data.recipientId;

        const recipient = await this.repository.findRecipientById(recipientId);
        if (!recipient) return;

        const canceled = await this.repository.isBroadcastCanceled(recipient.broadcastId);
        if (canceled) return;

        const claimed = await this.repository.claimRecipientForSending(recipientId);
        if (!claimed) return; // já não estava elegível (outro worker, cancelado, etc.)

        // Revalida cancelamento imediatamente antes de chamar o WhatsApp.
        const canceledAgain = await this.repository.isBroadcastCanceled(recipient.broadcastId);
        if (canceledAgain) return;

        try {
            const client = await this.sessionManager.getSession(claimed.tenantId);
            if (!client || !client.isConnected()) {
                throw Object.assign(new Error('WhatsApp desconectado'), { code: 'WHATSAPP_DISCONNECTED' });
            }

            // Conteúdo da campanha não está no destinatário; o use case já validou
            // formato no envio do POST — buscamos o texto via broadcastId.
            const broadcast = await this.getBroadcastContent(claimed.broadcastId, claimed.tenantId);
            await client.sendMessage(claimed.phoneSnapshot, broadcast);

            await this.repository.markRecipientSent(recipientId);
        } catch (err: any) {
            const errorCode = err?.code || 'SEND_ERROR';
            const errorMessage = (err?.message || 'Erro desconhecido ao enviar mensagem').slice(0, 500);

            if (claimed.attemptCount >= BROADCAST_MAX_ATTEMPTS) {
                await this.repository.markRecipientFailed(recipientId, errorCode, errorMessage);
            } else {
                const backoffMs = Math.min(60000, 2000 * 2 ** claimed.attemptCount) + Math.floor(Math.random() * 1000);
                await this.repository.markRecipientRetryWait(recipientId, new Date(Date.now() + backoffMs), errorCode, errorMessage);
            }
        } finally {
            await this.repository.recomputeBroadcastStatus(recipient.broadcastId);
        }
    }

    private async getBroadcastContent(broadcastId: string, tenantId: string): Promise<string> {
        const broadcast = await this.repository.findBroadcastById(tenantId, broadcastId);
        if (!broadcast) {
            throw Object.assign(new Error('Campanha não encontrada'), { code: 'BROADCAST_NOT_FOUND' });
        }
        return broadcast.content;
    }
}
