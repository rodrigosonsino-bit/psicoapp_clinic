import { IMessageRepository } from '../../domain/repositories/IMessageRepository';
import { IMessageSchedulerService } from '../services/IMessageSchedulerService';

export class DeleteMessageUseCase {
    constructor(
        private readonly messageRepository: IMessageRepository,
        private readonly messageScheduler: IMessageSchedulerService
    ) {}

    async execute(id: string, userId: string): Promise<void> {
        // 1. Verificar se a mensagem existe e seu status (e se pertence ao usuario)
        const message = await this.messageRepository.findById(id, userId);
        if (!message) {
            throw new Error('Message not found or unauthorized');
        }

        // 2. Se estiver pendente, removemos da fila do BullMQ
        if (message.status === 'pending') {
            await this.messageScheduler.cancel(id);
        }

        // 3. Deletamos do Banco de Dados
        await this.messageRepository.delete(id, userId);
    }
}
