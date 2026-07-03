import { injectable, inject } from 'tsyringe';
import { IBroadcastRepository } from '../../domain/repositories/IBroadcastRepository';
import { BroadcastQueue } from './BroadcastQueue';
import { logger } from '../logger';

const RECONCILIATION_MS = Number(process.env.BROADCAST_RECONCILIATION_MS || 30000);
const BATCH_SIZE = 100;

/**
 * Outbox dispatcher: o PostgreSQL é a fonte de verdade. Publica jobs no Redis
 * para destinatários `queued`/`retry_wait` vencidos. Roda em intervalo fixo
 * (reconciliação) e também pode ser acionado imediatamente via notify(),
 * sem que o sucesso do POST de criação dependa da publicação no Redis.
 */
@injectable()
export class BroadcastOutboxDispatcher {
    private intervalHandle: ReturnType<typeof setInterval> | null = null;
    private running = false;

    constructor(
        @inject('IBroadcastRepository') private readonly repository: IBroadcastRepository,
        @inject(BroadcastQueue) private readonly queue: BroadcastQueue
    ) {}

    start(): void {
        if (this.intervalHandle) return;
        this.intervalHandle = setInterval(() => {
            this.dispatchDue().catch(err => logger.error({ err }, 'Erro na reconciliação do outbox de broadcast.'));
        }, RECONCILIATION_MS);
    }

    stop(): void {
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
    }

    /** Aciona uma publicação imediata, sem bloquear o chamador. */
    notify(): void {
        this.dispatchDue().catch(err => logger.error({ err }, 'Erro ao publicar jobs de broadcast imediatamente.'));
    }

    private async dispatchDue(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            const due = await this.repository.findDueRecipients(BATCH_SIZE);
            for (const recipient of due) {
                await this.queue.addRecipientJob(recipient.id);
            }
        } finally {
            this.running = false;
        }
    }
}
