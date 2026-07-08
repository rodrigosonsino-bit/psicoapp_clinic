export interface WhatsappCloudTemplateBinding {
    id: string;
    purpose: string;
    metaTemplateName: string;
    languageCode: string;
    parameterSchema: { body?: string[]; header?: string[]; buttons?: string[] };
    metaStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DISABLED';
    active: boolean;
}

export type SubmissionResult = 'reserved' | 'accepted' | 'rejected' | 'unknown';

export interface FinalizeAttemptInput {
    attemptNumber: number;
    httpStatus?: number;
    submissionResult: Exclude<SubmissionResult, 'reserved'>;
    providerMessageId?: string;
    providerErrorCode?: string;
    /** Sanitizada/curta — nunca incluir telefone ou corpo da mensagem. */
    providerErrorMessage?: string;
}

export type CloudDeliveryStatus = 'submitted' | 'delivered' | 'read' | 'failed';

export interface WebhookStatusEvent {
    providerMessageId: string;
    statusValue: 'sent' | 'delivered' | 'read' | 'failed';
    providerTimestamp: Date;
    rawPayload: unknown;
}

/** Mensagem inbound normalizada — deliberadamente sem o payload bruto da Meta (minimização de
 * dado sensível): só o necessário para montar a notificação de encaminhamento. */
export interface WebhookMessageEvent {
    providerMessageId: string;
    fromPhoneDigits: string;
    contactName: string | null;
    textPreview: string;
    providerTimestamp: Date;
}

export interface PendingWebhookEvent {
    id: string;
    eventType: 'status' | 'message';
    providerMessageId: string | null;
    statusValue: string | null;
    providerTimestamp: Date | null;
    rawPayload: unknown;
    processingAttempts: number;
}

/** Resultado de tentar avançar o status de entrega — distingue "não achei a mensagem" (pode ser
 * uma corrida com createDeliveryRecord ainda não commitado, vale reprocessar) de "achei mas a
 * transição não é válida" (evento fora de ordem/duplicado, seguro descartar). */
export type AdvanceDeliveryOutcome = 'updated' | 'ignored_invalid_transition' | 'not_found';

/**
 * Repositório dedicado à WhatsApp Cloud API — deliberadamente separado de
 * IPsychotherapyRepository para não acoplar o adapter/domínio da Cloud API ao repositório
 * principal (já grande). markReminderSent/hasReminderBeenSent continuam em
 * IPsychotherapyRepository e são reaproveitados sem alteração de comportamento para Baileys.
 */
export interface IWhatsappCloudRepository {
    getActiveTemplate(purpose: string, languageCode: string): Promise<WhatsappCloudTemplateBinding | null>;

    /**
     * Reserva atomicamente o próximo número de tentativa para o agendamento, inserindo uma linha
     * com submission_result='reserved' ANTES de chamar a Meta. Se outra execução já reservou uma
     * tentativa concorrente (corrida), a UNIQUE(appointment_id, attempt_number) faz o INSERT
     * falhar — o método captura isso e retorna null, sinalizando "não prossiga com o envio".
     */
    reserveAttempt(tenantId: string, appointmentId: string): Promise<number | null>;

    /** Atualiza a linha reservada por reserveAttempt com o resultado real da chamada à Meta. */
    finalizeAttempt(appointmentId: string, input: FinalizeAttemptInput): Promise<void>;

    /** Cria a projeção de status inicial ('submitted') logo após a Meta aceitar o envio. */
    createDeliveryRecord(providerMessageId: string, tenantId: string, appointmentId: string): Promise<void>;

    /**
     * Avança o status de entrega respeitando transições válidas explícitas (não um rank
     * numérico linear): submitted→delivered/read/failed; delivered→read; read e failed são
     * terminais. Retorna 'not_found' quando a linha de status ainda não existe (possível corrida
     * com createDeliveryRecord) — o chamador deve reagendar o evento em vez de descartá-lo.
     */
    advanceDeliveryStatus(
        providerMessageId: string,
        newStatus: Exclude<CloudDeliveryStatus, 'submitted'>,
        statusAt: Date | null
    ): Promise<AdvanceDeliveryOutcome>;

    /**
     * Insere um evento de status na inbox durável do webhook. Deduplica por
     * (provider_message_id, status_value, provider_timestamp) — retorna false se já existia
     * (evento duplicado, at-least-once da Meta).
     */
    insertWebhookStatusEvent(event: WebhookStatusEvent): Promise<boolean>;

    /**
     * Insere uma mensagem inbound normalizada (só os campos necessários para a notificação —
     * nunca o payload bruto da Meta). Deduplica por provider_message_id (migration 087) —
     * retorna false se já existia (reentrega at-least-once da Meta).
     */
    insertWebhookMessageEvent(event: WebhookMessageEvent): Promise<boolean>;

    /** Reivindica (claim) eventos pendentes de processamento para o worker durável, com lease
     * (claimed_until) para impedir que uma execução sobreposta do cron reprocesse a mesma linha. */
    claimPendingWebhookEvents(limit: number, leaseSeconds: number): Promise<PendingWebhookEvent[]>;
    markWebhookEventProcessed(id: string): Promise<void>;
    markWebhookEventFailed(id: string, nextRetryAt: Date, deadLetter: boolean): Promise<void>;
}
