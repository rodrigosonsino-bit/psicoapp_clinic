import * as cron from 'node-cron';
import { IWhatsappCloudRepository, PendingWebhookEvent, CloudDeliveryStatus } from '../../domain/repositories/IWhatsappCloudRepository';
import { logger } from '../logger';

const BATCH_SIZE = 25;
const LEASE_SECONDS = 300; // 5 minutos — bem acima do tempo esperado de processamento de um lote
const MAX_PROCESSING_ATTEMPTS = 8;
/** Retry rápido para o caso "not_found" (corrida com createDeliveryRecord ainda não commitado) —
 * não precisa do backoff exponencial cheio, a corrida normalmente se resolve em segundos. */
const NOT_FOUND_RETRY_MS = 15_000;

/** Backoff exponencial para falhas de PROCESSAMENTO local (não relacionado ao backoff HTTP do
 * WhatsappCloudClient, que trata falhas de rede/HTTP com a Meta). */
function nextRetryDelayMs(attempts: number): number {
    return Math.min(60_000 * Math.pow(2, attempts), 30 * 60_000); // cap em 30 min
}

/**
 * Processa a inbox durável de eventos do webhook da Cloud API fora do ciclo da requisição HTTP.
 * "Grava inbox, responde 2xx, processa depois" só é seguro com um worker como este: se o
 * processo cair entre a inserção e o processamento, o evento continua em processed_at IS NULL
 * e será reivindicado (claim, com FOR UPDATE SKIP LOCKED + lease) na próxima execução — nada se
 * perde. O lease (claimed_until) evita que uma execução sobreposta do cron reprocesse a mesma
 * linha antes do processamento anterior terminar.
 */
export class WhatsappCloudInboxWorker {
    private task: ReturnType<typeof cron.schedule> | null = null;

    constructor(private readonly repository: IWhatsappCloudRepository) {}

    /** Roda a cada minuto — baixo volume esperado no piloto, não precisa de mais frequência. */
    start(): void {
        this.task = cron.schedule('* * * * *', async () => {
            await this.processBatch();
        });
        logger.info('📬 WhatsappCloudInboxWorker iniciado (processa a inbox do webhook a cada minuto)');
    }

    stop(): void {
        this.task?.stop();
    }

    async processBatch(): Promise<void> {
        let events: PendingWebhookEvent[];
        try {
            events = await this.repository.claimPendingWebhookEvents(BATCH_SIZE, LEASE_SECONDS);
        } catch (err) {
            logger.error({ err }, '❌ WhatsappCloudInboxWorker: falha ao reivindicar eventos pendentes');
            return;
        }

        if (events.length === 0) return;

        for (const event of events) {
            await this.processEvent(event);
        }
    }

    private async processEvent(event: PendingWebhookEvent): Promise<void> {
        try {
            if (event.eventType === 'status') {
                const handled = await this.processStatusEvent(event);
                if (!handled) return; // já reagendado dentro de processStatusEvent
            }
            // event_type='message' (inbound) fica fora de escopo do piloto — marcado como
            // processado sem ação, apenas para não ficar reprocessando indefinidamente.
            await this.repository.markWebhookEventProcessed(event.id);
        } catch (err) {
            const deadLetter = event.processingAttempts >= MAX_PROCESSING_ATTEMPTS;
            logger.error({ err, eventId: event.id, attempts: event.processingAttempts, deadLetter },
                '❌ WhatsappCloudInboxWorker: falha ao processar evento — reagendando' + (deadLetter ? ' (dead-letter)' : ''));
            await this.repository.markWebhookEventFailed(
                event.id,
                new Date(Date.now() + nextRetryDelayMs(event.processingAttempts)),
                deadLetter
            );
        }
    }

    /** Retorna true se o evento pode ser marcado como processado pelo chamador; false se já foi
     * reagendado internamente (não deve ser marcado como processado ainda). */
    private async processStatusEvent(event: PendingWebhookEvent): Promise<boolean> {
        if (!event.providerMessageId || !event.statusValue) return true; // evento incompleto — descarta
        if (event.statusValue === 'sent') return true; // 'submitted' já é o estado inicial, nada a avançar

        const newStatus = event.statusValue as Exclude<CloudDeliveryStatus, 'submitted'>;
        const outcome = await this.repository.advanceDeliveryStatus(event.providerMessageId, newStatus, event.providerTimestamp);

        if (outcome === 'not_found') {
            // Provável corrida com createDeliveryRecord (chamado logo após a Meta aceitar o
            // envio) ainda não commitado — reagenda rapidamente em vez de descartar o status.
            const deadLetter = event.processingAttempts >= MAX_PROCESSING_ATTEMPTS;
            logger.warn({ eventId: event.id, providerMessageId: event.providerMessageId, deadLetter },
                'WhatsappCloudInboxWorker: delivery record ainda não existe — reagendando' + (deadLetter ? ' (dead-letter)' : ''));
            await this.repository.markWebhookEventFailed(
                event.id,
                new Date(Date.now() + (deadLetter ? nextRetryDelayMs(event.processingAttempts) : NOT_FOUND_RETRY_MS)),
                deadLetter
            );
            return false;
        }

        if (outcome === 'ignored_invalid_transition') {
            logger.debug({ eventId: event.id, status: newStatus },
                'WhatsappCloudInboxWorker: transição de status ignorada (fora de ordem, duplicada ou a partir de estado terminal)');
        }

        return true;
    }
}
