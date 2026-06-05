import { ScheduledMessage } from '../../domain/models/ScheduledMessage';

export interface IMessageSchedulerService {
    schedule(message: ScheduledMessage, delayMs: number): Promise<void>;
    cancel(messageId: string): Promise<void>;
}
