import { Pool } from 'pg';
import {
    IWhatsappCloudRepository,
    WhatsappCloudTemplateBinding,
    FinalizeAttemptInput,
    WebhookStatusEvent,
    WebhookMessageEvent,
    PendingWebhookEvent,
    CloudDeliveryStatus,
    AdvanceDeliveryOutcome,
} from '../../domain/repositories/IWhatsappCloudRepository';

const UNIQUE_VIOLATION = '23505';

/** Transições válidas de status de entrega — 'failed' e 'read' são terminais (nenhuma saída). */
const ALLOWED_TRANSITIONS: Record<CloudDeliveryStatus, CloudDeliveryStatus[]> = {
    submitted: ['delivered', 'read', 'failed'],
    delivered: ['read'],
    read: [],
    failed: [],
};

export class PostgresWhatsappCloudRepository implements IWhatsappCloudRepository {
    constructor(private readonly dbPool: Pool) {}

    async getActiveTemplate(purpose: string, languageCode: string): Promise<WhatsappCloudTemplateBinding | null> {
        const result = await this.dbPool.query(
            `SELECT id, purpose, meta_template_name, language_code, parameter_schema, meta_status, active
             FROM whatsapp_cloud_templates
             WHERE purpose = $1 AND language_code = $2 AND active = TRUE
             LIMIT 1;`,
            [purpose, languageCode]
        );
        if (result.rows.length === 0) return null;
        const row = result.rows[0];
        return {
            id: row.id,
            purpose: row.purpose,
            metaTemplateName: row.meta_template_name,
            languageCode: row.language_code,
            parameterSchema: row.parameter_schema,
            metaStatus: row.meta_status,
            active: row.active,
        };
    }

    async reserveAttempt(tenantId: string, appointmentId: string): Promise<number | null> {
        try {
            const result = await this.dbPool.query(
                `INSERT INTO psychotherapy_whatsapp_cloud_attempts
                    (tenant_id, appointment_id, attempt_number, submission_result)
                 SELECT $1, $2, COALESCE(MAX(attempt_number), 0) + 1, 'reserved'
                 FROM psychotherapy_whatsapp_cloud_attempts
                 WHERE appointment_id = $2
                 RETURNING attempt_number;`,
                [tenantId, appointmentId]
            );
            return Number(result.rows[0].attempt_number);
        } catch (err: any) {
            if (err?.code === UNIQUE_VIOLATION) {
                // Corrida real: outra execução reservou a mesma tentativa antes desta transação
                // commitar. Não é seguro prosseguir — retornar null sinaliza "não envie".
                return null;
            }
            throw err;
        }
    }

    async finalizeAttempt(appointmentId: string, input: FinalizeAttemptInput): Promise<void> {
        await this.dbPool.query(
            `UPDATE psychotherapy_whatsapp_cloud_attempts
             SET http_status = $3, submission_result = $4, provider_message_id = $5,
                 provider_error_code = $6, provider_error_message = $7
             WHERE appointment_id = $1 AND attempt_number = $2;`,
            [
                appointmentId,
                input.attemptNumber,
                input.httpStatus ?? null,
                input.submissionResult,
                input.providerMessageId ?? null,
                input.providerErrorCode ?? null,
                input.providerErrorMessage ?? null,
            ]
        );
    }

    async createDeliveryRecord(providerMessageId: string, tenantId: string, appointmentId: string): Promise<void> {
        await this.dbPool.query(
            `INSERT INTO psychotherapy_whatsapp_cloud_status
                (provider_message_id, tenant_id, appointment_id, delivery_status)
             VALUES ($1, $2, $3, 'submitted')
             ON CONFLICT (provider_message_id) DO NOTHING;`,
            [providerMessageId, tenantId, appointmentId]
        );
    }

    async advanceDeliveryStatus(
        providerMessageId: string,
        newStatus: Exclude<CloudDeliveryStatus, 'submitted'>,
        statusAt: Date | null
    ): Promise<AdvanceDeliveryOutcome> {
        const client = await this.dbPool.connect();
        try {
            await client.query('BEGIN');

            const current = await client.query(
                `SELECT delivery_status FROM psychotherapy_whatsapp_cloud_status
                 WHERE provider_message_id = $1 FOR UPDATE;`,
                [providerMessageId]
            );

            if (current.rows.length === 0) {
                await client.query('ROLLBACK');
                // Pode ser uma corrida com createDeliveryRecord ainda não commitado — o chamador
                // deve reagendar o evento, não descartá-lo como se fosse duplicado.
                return 'not_found';
            }

            const currentStatus: CloudDeliveryStatus = current.rows[0].delivery_status;
            if (!ALLOWED_TRANSITIONS[currentStatus].includes(newStatus)) {
                await client.query('ROLLBACK');
                return 'ignored_invalid_transition';
            }

            await client.query(
                `UPDATE psychotherapy_whatsapp_cloud_status
                 SET delivery_status = $2, last_status_at = COALESCE($3, last_status_at), updated_at = NOW()
                 WHERE provider_message_id = $1;`,
                [providerMessageId, newStatus, statusAt]
            );

            await client.query('COMMIT');
            return 'updated';
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
        } finally {
            client.release();
        }
    }

    async insertWebhookStatusEvent(event: WebhookStatusEvent): Promise<boolean> {
        const result = await this.dbPool.query(
            `INSERT INTO whatsapp_cloud_webhook_events
                (event_type, provider_message_id, status_value, provider_timestamp, raw_payload)
             VALUES ('status', $1, $2, $3, $4::jsonb)
             ON CONFLICT (provider_message_id, status_value, provider_timestamp)
                 WHERE event_type = 'status'
             DO NOTHING
             RETURNING id;`,
            [event.providerMessageId, event.statusValue, event.providerTimestamp, JSON.stringify(event.rawPayload)]
        );
        return (result.rowCount ?? 0) > 0;
    }

    async insertWebhookMessageEvent(event: WebhookMessageEvent): Promise<boolean> {
        // raw_payload guarda só os campos normalizados (nunca o envelope bruto da Meta) —
        // minimização de dado sensível de paciente, mantendo a coluna JSONB NOT NULL existente.
        const normalized = {
            fromPhoneDigits: event.fromPhoneDigits,
            contactName: event.contactName,
            textPreview: event.textPreview,
        };
        const result = await this.dbPool.query(
            `INSERT INTO whatsapp_cloud_webhook_events
                (event_type, provider_message_id, provider_timestamp, raw_payload)
             VALUES ('message', $1, $2, $3::jsonb)
             ON CONFLICT (provider_message_id) WHERE event_type = 'message'
                 DO NOTHING
             RETURNING id;`,
            [event.providerMessageId, event.providerTimestamp, JSON.stringify(normalized)]
        );
        return (result.rowCount ?? 0) > 0;
    }

    async claimPendingWebhookEvents(limit: number, leaseSeconds: number): Promise<PendingWebhookEvent[]> {
        // Lease (claimed_until) impede que uma execução sobreposta do cron reivindique a mesma
        // linha depois que a transação de claim anterior já commitou — FOR UPDATE SKIP LOCKED
        // por si só só protege durante a própria transação.
        const result = await this.dbPool.query(
            `UPDATE whatsapp_cloud_webhook_events
             SET processing_attempts = processing_attempts + 1,
                 claimed_until = NOW() + make_interval(secs => $2)
             WHERE id IN (
                 SELECT id FROM whatsapp_cloud_webhook_events
                 WHERE processed_at IS NULL AND dead_letter = FALSE AND next_retry_at <= NOW()
                   AND (claimed_until IS NULL OR claimed_until < NOW())
                 ORDER BY received_at ASC
                 LIMIT $1
                 FOR UPDATE SKIP LOCKED
             )
             RETURNING id, event_type, provider_message_id, status_value, provider_timestamp,
                       raw_payload, processing_attempts;`,
            [limit, leaseSeconds]
        );
        return result.rows.map(row => ({
            id: row.id,
            eventType: row.event_type,
            providerMessageId: row.provider_message_id,
            statusValue: row.status_value,
            providerTimestamp: row.provider_timestamp,
            rawPayload: row.raw_payload,
            processingAttempts: row.processing_attempts,
        }));
    }

    async markWebhookEventProcessed(id: string): Promise<void> {
        await this.dbPool.query(
            `UPDATE whatsapp_cloud_webhook_events SET processed_at = NOW(), claimed_until = NULL WHERE id = $1;`,
            [id]
        );
    }

    async markWebhookEventFailed(id: string, nextRetryAt: Date, deadLetter: boolean): Promise<void> {
        await this.dbPool.query(
            `UPDATE whatsapp_cloud_webhook_events
             SET next_retry_at = $2, dead_letter = $3, claimed_until = NULL
             WHERE id = $1;`,
            [id, nextRetryAt, deadLetter]
        );
    }
}
