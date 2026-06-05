export { ScheduledMessage } from './domain/models/ScheduledMessage';
export type { MessageStatus, MessagePlatform } from './domain/models/ScheduledMessage';

export type { IMessageRepository, UpdateMessageDTO, MessageFilters } from './domain/repositories/IMessageRepository';

export type { IMessageSchedulerService } from './application/services/IMessageSchedulerService';

export { usePostgresAuthState } from './infrastructure/database/PostgresAuthState';
export { BullMQMessageScheduler } from './infrastructure/queue/BullMQMessageScheduler';
export { MessageWorker } from './infrastructure/queue/MessageWorker';
export type { IUsageTracker, IExternalSender } from './infrastructure/queue/MessageWorker';
export { WhatsappClient } from './infrastructure/whatsapp/WhatsappClient';
export type { IncomingMessageContext, IncomingMessageHandler, WhatsappClientOptions } from './infrastructure/whatsapp/WhatsappClient';
export { WhatsappSessionManager } from './infrastructure/whatsapp/WhatsappSessionManager';
