import * as cron from 'node-cron';
import { IWhatsappCloudRepository, PendingWebhookEvent, CloudDeliveryStatus } from '../../domain/repositories/IWhatsappCloudRepository';
import { WhatsappCloudClient } from '../whatsappCloud/WhatsappCloudClient';
import { logger } from '../logger';

/** Config do encaminhamento de mensagens recebidas para o número pessoal — deliberadamente sem
 * nenhuma automação/resposta ao paciente, só uma notificação de texto via template aprovado. */
export interface InboundNotifyConfig {
    client: WhatsappCloudClient;
    notifyPhoneDigits: string;
    /** Tenant único servido por este piloto — necessário para escopar a correspondência de
     * telefone com paciente (nunca buscar entre tenants). */
    tenantId: string;
}

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

    constructor(
        private readonly repository: IWhatsappCloudRepository,
        private readonly notifyConfig?: InboundNotifyConfig
    ) {}

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
            } else if (event.eventType === 'message') {
                await this.processMessageEvent(event);
            }
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

    /**
     * Encaminha a mensagem recebida como notificação de texto para o número pessoal — SEM
     * nenhuma automação ou resposta ao paciente (escopo deliberadamente mínimo, ver plano de
     * migração). Se o encaminhamento não estiver configurado ou o template não estiver aprovado,
     * apenas loga e segue (fail-safe: nunca deve derrubar o processamento da inbox por causa de
     * um recurso opcional de notificação).
     */
    private async processMessageEvent(event: PendingWebhookEvent): Promise<void> {
        if (!this.notifyConfig) return;

        const payload = event.rawPayload as { fromPhoneDigits?: string; contactName?: string | null; textPreview?: string } | null;
        if (!payload?.fromPhoneDigits || !payload.textPreview) return;

        // Histórico de conversa exibido na ficha do paciente — só visualização, sem automação.
        // Independente do resultado (casou ou não com paciente), a notificação abaixo continua
        // normalmente para o número pessoal.
        if (event.providerMessageId) {
            try {
                await this.repository.insertInboundMessageIfPatientMatch({
                    tenantId: this.notifyConfig.tenantId,
                    fromPhoneDigits: payload.fromPhoneDigits,
                    providerMessageId: event.providerMessageId,
                    body: payload.textPreview,
                    occurredAt: event.providerTimestamp ?? new Date(),
                });
            } catch (err) {
                logger.warn({ err }, 'WhatsappCloudInboxWorker: falha ao registrar histórico de conversa do paciente (não afeta a notificação).');
            }
        }

        const template = await this.repository.getActiveTemplate('patient_reply_notify', 'pt_BR');
        if (!template || template.metaStatus !== 'APPROVED') {
            logger.warn('WhatsappCloudInboxWorker: template de notificação de resposta ainda não aprovado/ativo — encaminhamento pulado.');
            return;
        }

        const displayName = payload.contactName || payload.fromPhoneDigits;
        const outcome = await this.notifyConfig.client.sendTemplateMessage(
            this.notifyConfig.notifyPhoneDigits,
            template.metaTemplateName,
            template.languageCode,
            [{ type: 'body', values: [displayName, payload.textPreview] }]
        );

        if (outcome.kind !== 'accepted') {
            logger.warn({ outcome: outcome.kind, errorMessage: outcome.errorMessage },
                'WhatsappCloudInboxWorker: falha ao encaminhar notificação de resposta para o número pessoal.');
        }
    }
}
