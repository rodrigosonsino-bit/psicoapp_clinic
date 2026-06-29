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
    /** Grava o id da mensagem no WhatsApp (Baileys) logo após o envio, para permitir correlacionar receipts de entrega/leitura posteriormente. */
    attachWhatsappMessageId(id: string, waMessageId: string): Promise<void>;
    /** Atualiza o status a partir de um receipt do WhatsApp (delivery/read), correlacionando pelo id da mensagem no WhatsApp. */
    updateDeliveryStatusByWaId(tenantId: string, waMessageId: string, status: 'delivered' | 'read'): Promise<void>;
    findById(id: string, userId?: string): Promise<ScheduledMessage | null>;
    findAll(userId: string, limit?: number, offset?: number, filters?: MessageFilters): Promise<ScheduledMessage[]>;
    findAllPending(): Promise<ScheduledMessage[]>;
    findRecentFailed(withinHours?: number): Promise<ScheduledMessage[]>;
    delete(id: string, userId: string): Promise<void>;
}
