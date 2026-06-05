import { IMessageRepository, UpdateMessageDTO } from '../../domain/repositories/IMessageRepository';
import { IMessageSchedulerService } from '../services/IMessageSchedulerService';
import { ScheduledMessage, MessagePlatform } from '../../domain/models/ScheduledMessage';

export interface UpdateMessageRequestDTO {
    id: string;
    userId: string;
    content?: string;
    recipientId?: string;
    sendAt?: Date;
    platform?: MessagePlatform;
    recurrence?: string;
    imageUrl?: string;
}

export class UpdateMessageUseCase {
    constructor(
        private readonly messageRepository: IMessageRepository,
        private readonly messageScheduler: IMessageSchedulerService
    ) {}

    async execute(dto: UpdateMessageRequestDTO): Promise<ScheduledMessage> {
        console.log(`[UpdateMessageUseCase] Iniciando execução para ID: ${dto.id}`);
        if (!dto.id) throw new Error('Message ID is required');
        if (!dto.userId) throw new Error('User ID is required');

        if (dto.content !== undefined && dto.content.trim() === '') {
            throw new Error('Message content cannot be empty');
        }
        if (dto.recipientId !== undefined && dto.recipientId.trim() === '') {
            throw new Error('Recipient ID cannot be empty');
        }
        
        // Obter a mensagem original antes da atualização para saber seu status e dados anteriores
        const original = await this.messageRepository.findById(dto.id, dto.userId);
        if (!original) {
            throw new Error('Message not found or unauthorized');
        }

        const fields: UpdateMessageDTO = {};
        const existingMessage = { ...original };
        if (dto.content !== undefined) fields.content = dto.content;
        if (dto.recipientId !== undefined) fields.recipientId = dto.recipientId;
        if (dto.sendAt !== undefined) fields.sendAt = dto.sendAt;
        if (dto.platform !== undefined) fields.platform = dto.platform;
        if (dto.recurrence !== undefined) {
            existingMessage.metadata = { ...existingMessage.metadata, recurrence: dto.recurrence };
        }
        if (dto.imageUrl !== undefined) {
            existingMessage.metadata = { ...existingMessage.metadata, imageUrl: dto.imageUrl };
        }
        fields.metadata = existingMessage.metadata;

        console.log(`[UpdateMessageUseCase] Campos para atualizar:`, Object.keys(fields));

        // Persist the updated fields (sets status back to 'pending' and works for any original status)
        console.log(`[UpdateMessageUseCase] Chamando repository.update...`);
        const updated = await this.messageRepository.update(dto.id, dto.userId, fields);
        console.log(`[UpdateMessageUseCase] Repository.update concluído.`);

        // Se a mensagem original não estava pendente, ou se a data ou a plataforma mudou, precisamos enfileirar no BullMQ!
        const wasNotPending = original.status !== 'pending';
        const dateChanged = dto.sendAt !== undefined && dto.sendAt.getTime() !== original.sendAt.getTime();
        const platformChanged = dto.platform !== undefined && dto.platform !== original.platform;

        if (wasNotPending || dateChanged || platformChanged) {
            console.log(`[UpdateMessageUseCase] Re-agendamento necessário (status anterior: ${original.status}). Ajustando fila...`);
            console.log(`[UpdateMessageUseCase] Chamando scheduler.cancel...`);
            await this.messageScheduler.cancel(dto.id);
            console.log(`[UpdateMessageUseCase] Scheduler.cancel concluído.`);
            
            const delayMs = Math.max(0, updated.sendAt.getTime() - Date.now());
            console.log(`[UpdateMessageUseCase] Chamando scheduler.schedule com delay ${delayMs}ms...`);
            await this.messageScheduler.schedule(updated, delayMs);
            console.log(`[UpdateMessageUseCase] Scheduler.schedule concluído.`);
        } else {
            console.log(`[UpdateMessageUseCase] Nenhuma alteração de data/plataforma em mensagem já pendente. Pulando reagendamento.`);
        }

        console.log(`[UpdateMessageUseCase] Execução finalizada com sucesso.`);
        return updated;
    }
}
