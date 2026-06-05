import { IMessageRepository, MessageFilters } from '../../domain/repositories/IMessageRepository';
import { ScheduledMessage } from '../../domain/models/ScheduledMessage';

export class ListMessagesUseCase {
    constructor(private readonly messageRepository: IMessageRepository) {}

    async execute(userId: string, page: number = 1, limit: number = 20, filters?: MessageFilters): Promise<ScheduledMessage[]> {
        const offset = (page - 1) * limit;
        return await this.messageRepository.findAll(userId, limit, offset, filters);
    }
}
