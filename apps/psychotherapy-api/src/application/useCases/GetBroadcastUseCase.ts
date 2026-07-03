import { injectable, inject } from 'tsyringe';
import { IBroadcastRepository } from '../../domain/repositories/IBroadcastRepository';
import { BroadcastWithCounts } from '../../domain/models/PsychotherapyBroadcast';
import { AppError } from '../../domain/errors/AppError';

@injectable()
export class GetBroadcastUseCase {
    constructor(
        @inject('IBroadcastRepository') private readonly repository: IBroadcastRepository
    ) {}

    async execute(tenantId: string, broadcastId: string): Promise<BroadcastWithCounts> {
        const broadcast = await this.repository.findBroadcastById(tenantId, broadcastId);
        if (!broadcast) {
            throw new AppError('Campanha não encontrada.', 404);
        }
        const counts = await this.repository.getStatusCounts(broadcastId);
        return { broadcast, counts };
    }

    async list(tenantId: string, limit: number): Promise<BroadcastWithCounts[]> {
        const broadcasts = await this.repository.listBroadcasts(tenantId, limit);
        return Promise.all(
            broadcasts.map(async broadcast => ({
                broadcast,
                counts: await this.repository.getStatusCounts(broadcast.id)
            }))
        );
    }
}
