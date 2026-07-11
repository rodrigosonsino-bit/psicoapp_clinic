import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository } from '../../../domain/repositories/IPsychotherapyRepository';

const APP_BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:5173';

@injectable()
export class GetPublicBookingTokenUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async execute(tenantId: string): Promise<{ token: string; url: string }> {
        const token = await this.repository.getOrCreatePublicBookingToken(tenantId);
        return { token, url: `${APP_BASE_URL}/self-book/${token}` };
    }
}
