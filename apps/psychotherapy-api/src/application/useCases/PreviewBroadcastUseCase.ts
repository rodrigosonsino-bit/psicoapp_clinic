import { injectable, inject } from 'tsyringe';
import { IBroadcastRepository } from '../../domain/repositories/IBroadcastRepository';
import { PhoneNormalizer } from '../services/PhoneNormalizer';
import { BroadcastPreview } from '../../domain/models/PsychotherapyBroadcast';

const MAX_RECIPIENTS = Number(process.env.BROADCAST_MAX_RECIPIENTS || 50);

@injectable()
export class PreviewBroadcastUseCase {
    private readonly phoneNormalizer = new PhoneNormalizer();

    constructor(
        @inject('IBroadcastRepository') private readonly repository: IBroadcastRepository
    ) {}

    async execute(tenantId: string): Promise<BroadcastPreview> {
        const [candidates, exclusions] = await Promise.all([
            this.repository.listEligibleCandidates(tenantId),
            this.repository.countExclusions(tenantId)
        ]);

        let invalidPhone = 0;
        let eligible = 0;
        for (const candidate of candidates) {
            if (this.phoneNormalizer.normalize(candidate.phone)) {
                eligible += 1;
            } else {
                invalidPhone += 1;
            }
        }

        return {
            eligible,
            excluded: {
                inactive: exclusions.inactive,
                deleted: exclusions.deleted,
                withoutPhone: exclusions.withoutPhone,
                invalidPhone,
                withoutOptIn: exclusions.withoutOptIn
            },
            maxRecipients: MAX_RECIPIENTS
        };
    }
}
