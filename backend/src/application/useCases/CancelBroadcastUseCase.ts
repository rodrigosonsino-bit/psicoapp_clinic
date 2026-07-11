import { injectable, inject } from 'tsyringe';
import { IBroadcastRepository } from '../../domain/repositories/IBroadcastRepository';
import { AppError } from '../../domain/errors/AppError';
import { BroadcastQueue } from '../../infrastructure/queue/BroadcastQueue';

@injectable()
export class CancelBroadcastUseCase {
    constructor(
        @inject('IBroadcastRepository') private readonly repository: IBroadcastRepository,
        @inject(BroadcastQueue) private readonly queue: BroadcastQueue
    ) {}

    async execute(tenantId: string, broadcastId: string): Promise<void> {
        const broadcast = await this.repository.findBroadcastById(tenantId, broadcastId);
        if (!broadcast) {
            throw new AppError('Campanha não encontrada.', 404);
        }

        const canceledRecipients = await this.repository.cancelBroadcast(tenantId, broadcastId);

        // Best-effort: remove jobs ainda não processados. Não garante remoção
        // se o worker já pegou o job (nesse caso o claim atômico no banco resolve).
        await Promise.all(
            canceledRecipients.map(recipient => this.queue.removeJob(recipient.id))
        );
    }
}
