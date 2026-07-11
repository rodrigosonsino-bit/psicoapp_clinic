import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { IMessageSchedulerService } from '../../application/services/IMessageSchedulerService';
import { ScheduledMessage } from '../../domain/models/ScheduledMessage';

export class BullMQMessageScheduler implements IMessageSchedulerService {
    private queue: Queue;

    constructor(
        redisConnection: IORedis,
        queueName: string = 'whatsapp-messages'
    ) {
        this.queue = new Queue(queueName, { connection: redisConnection as any });
    }

    async schedule(message: ScheduledMessage, delayMs: number): Promise<void> {
        if (!message.id) {
            throw new Error("Message must be saved and have an ID before scheduling");
        }

        await this.queue.add('send-message-job', { messageId: message.id }, {
            delay: delayMs,
            jobId: `msg-${message.id}`,
            attempts: 5,
            backoff: {
                type: 'exponential',
                delay: 5000,
            },
            removeOnComplete: true,
        });
    }

    async cancel(messageId: string): Promise<void> {
        const jobId = `msg-${messageId}`;
        const job = await this.queue.getJob(jobId);
        if (job) {
            await job.remove();
        }
    }
}
