import { ScheduledMessage, MessageStatus, MessagePlatform } from '../models/ScheduledMessage';

export interface UpdateMessageDTO {
    content?: string;
    recipientId?: string;
    sendAt?: Date;
    platform?: MessagePlatform;
    recurrence?: string;
    metadata?: any;
}

export interface MessageFilters {
    startDate?: Date;
    endDate?: Date;
    recipientId?: string;
}

export interface IMessageRepository {
    save(message: ScheduledMessage): Promise<ScheduledMessage>;
    update(id: string, userId: string, fields: UpdateMessageDTO): Promise<ScheduledMessage>;
    updateStatus(id: string, status: MessageStatus): Promise<void>;
    findById(id: string, userId?: string): Promise<ScheduledMessage | null>;
    findAll(userId: string, limit?: number, offset?: number, filters?: MessageFilters): Promise<ScheduledMessage[]>;
    findAllPending(): Promise<ScheduledMessage[]>;
    findRecentFailed(withinHours?: number): Promise<ScheduledMessage[]>;
    delete(id: string, userId: string): Promise<void>;
}
