import { Queue } from 'bullmq';
import { injectable } from 'tsyringe';
import { getBroadcastRedisConnection } from './redisConnection';

export const BROADCAST_QUEUE_NAME = 'psychotherapy-broadcast-recipients';

/**
 * Fila dedicada do psychotherapy-api. Não reutiliza a fila `whatsapp-messages`
 * do scheduler-api, que exige `scheduled_messages` + worker próprios daquele app
 * (ver docs/broadcast-message-plan.md, seção 1.1).
 */
@injectable()
export class BroadcastQueue {
    public readonly queue: Queue;

    constructor() {
        this.queue = new Queue(BROADCAST_QUEUE_NAME, { connection: getBroadcastRedisConnection() as any });
    }

    async addRecipientJob(recipientId: string): Promise<void> {
        await this.queue.add(
            'send-broadcast-recipient',
            { recipientId },
            {
                jobId: `broadcast-recipient-${recipientId}`,
                attempts: 1, // tentativas/backoff vivem no estado persistido, não no BullMQ
                removeOnComplete: true,
                removeOnFail: true
            }
        );
    }

    async removeJob(recipientId: string): Promise<void> {
        const job = await this.queue.getJob(`broadcast-recipient-${recipientId}`);
        if (job) {
            await job.remove().catch(() => undefined);
        }
    }

    async close(): Promise<void> {
        await this.queue.close();
    }
}
