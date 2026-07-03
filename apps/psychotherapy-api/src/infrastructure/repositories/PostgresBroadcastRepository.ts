import { Pool } from 'pg';
import { injectable } from 'tsyringe';
import { IBroadcastRepository, ExclusionCounts } from '../../domain/repositories/IBroadcastRepository';
import { AppError } from '../../domain/errors/AppError';
import {
    PsychotherapyBroadcast,
    PsychotherapyBroadcastRecipient,
    BroadcastRecipientCandidate,
    BroadcastStatusCounts,
    BroadcastStatus,
    BroadcastRecipientStatus
} from '../../domain/models/PsychotherapyBroadcast';

const ACTIVE_STATUSES = ['weekly', 'biweekly', 'one_off'];

function mapBroadcast(row: any): PsychotherapyBroadcast {
    return new PsychotherapyBroadcast(
        row.id,
        row.tenant_id,
        row.idempotency_key,
        row.content,
        row.status,
        row.total_recipients,
        row.created_at,
        row.started_at,
        row.completed_at,
        row.canceled_at
    );
}

function mapRecipient(row: any): PsychotherapyBroadcastRecipient {
    return new PsychotherapyBroadcastRecipient(
        row.id,
        row.broadcast_id,
        row.tenant_id,
        row.patient_id,
        row.patient_name_snapshot,
        row.phone_snapshot,
        row.status,
        row.attempt_count,
        row.next_attempt_at,
        row.locked_at,
        row.sent_at,
        row.last_error_code,
        row.last_error_message,
        row.created_at
    );
}

@injectable()
export class PostgresBroadcastRepository implements IBroadcastRepository {
    constructor(private readonly dbPool: Pool) {}

    async listEligibleCandidates(tenantId: string): Promise<BroadcastRecipientCandidate[]> {
        const { rows } = await this.dbPool.query(
            `SELECT id, name, phone
             FROM psychotherapy_patients
             WHERE tenant_id = $1
               AND status = ANY($2::varchar[])
               AND deleted_at IS NULL
               AND whatsapp_bulk_opt_in = TRUE
               AND phone IS NOT NULL
               AND btrim(phone) <> ''`,
            [tenantId, ACTIVE_STATUSES]
        );
        return rows.map((r: any) => ({ patientId: r.id, name: r.name, phone: r.phone }));
    }

    async countExclusions(tenantId: string): Promise<ExclusionCounts> {
        const { rows } = await this.dbPool.query(
            `SELECT
                COUNT(*) FILTER (WHERE deleted_at IS NULL AND status NOT IN ('weekly', 'biweekly', 'one_off')) AS inactive,
                COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) AS deleted,
                COUNT(*) FILTER (
                    WHERE deleted_at IS NULL
                      AND status IN ('weekly', 'biweekly', 'one_off')
                      AND (phone IS NULL OR btrim(phone) = '')
                ) AS without_phone,
                COUNT(*) FILTER (
                    WHERE deleted_at IS NULL
                      AND status IN ('weekly', 'biweekly', 'one_off')
                      AND phone IS NOT NULL AND btrim(phone) <> ''
                      AND whatsapp_bulk_opt_in = FALSE
                ) AS without_opt_in
             FROM psychotherapy_patients
             WHERE tenant_id = $1`,
            [tenantId]
        );
        const r = rows[0];
        return {
            inactive: Number(r.inactive),
            deleted: Number(r.deleted),
            withoutPhone: Number(r.without_phone),
            withoutOptIn: Number(r.without_opt_in)
        };
    }

    async findBroadcastByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<PsychotherapyBroadcast | null> {
        const { rows } = await this.dbPool.query(
            `SELECT * FROM psychotherapy_broadcasts WHERE tenant_id = $1 AND idempotency_key = $2`,
            [tenantId, idempotencyKey]
        );
        return rows[0] ? mapBroadcast(rows[0]) : null;
    }

    async hasActiveBroadcast(tenantId: string): Promise<boolean> {
        const { rows } = await this.dbPool.query(
            `SELECT 1 FROM psychotherapy_broadcasts WHERE tenant_id = $1 AND status IN ('queued', 'processing') LIMIT 1`,
            [tenantId]
        );
        return rows.length > 0;
    }

    async createBroadcastWithRecipients(
        tenantId: string,
        idempotencyKey: string,
        content: string,
        candidates: BroadcastRecipientCandidate[]
    ): Promise<PsychotherapyBroadcast> {
        const client = await this.dbPool.connect();
        try {
            await client.query('BEGIN');

            const { rows } = await client.query(
                `INSERT INTO psychotherapy_broadcasts (tenant_id, idempotency_key, content, status, total_recipients)
                 VALUES ($1, $2, $3, 'queued', $4)
                 RETURNING *`,
                [tenantId, idempotencyKey, content, candidates.length]
            );
            const broadcast = mapBroadcast(rows[0]);

            for (const candidate of candidates) {
                await client.query(
                    `INSERT INTO psychotherapy_broadcast_recipients
                        (broadcast_id, tenant_id, patient_id, patient_name_snapshot, phone_snapshot, status)
                     VALUES ($1, $2, $3, $4, $5, 'queued')`,
                    [broadcast.id, tenantId, candidate.patientId, candidate.name, candidate.phone]
                );
            }

            await client.query('COMMIT');
            return broadcast;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    async findBroadcastById(tenantId: string, broadcastId: string): Promise<PsychotherapyBroadcast | null> {
        const { rows } = await this.dbPool.query(
            `SELECT * FROM psychotherapy_broadcasts WHERE id = $1 AND tenant_id = $2`,
            [broadcastId, tenantId]
        );
        return rows[0] ? mapBroadcast(rows[0]) : null;
    }

    async listBroadcasts(tenantId: string, limit: number): Promise<PsychotherapyBroadcast[]> {
        const { rows } = await this.dbPool.query(
            `SELECT * FROM psychotherapy_broadcasts WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
            [tenantId, limit]
        );
        return rows.map(mapBroadcast);
    }

    async getStatusCounts(broadcastId: string): Promise<BroadcastStatusCounts> {
        const { rows } = await this.dbPool.query(
            `SELECT status, COUNT(*) AS count FROM psychotherapy_broadcast_recipients WHERE broadcast_id = $1 GROUP BY status`,
            [broadcastId]
        );
        const counts: BroadcastStatusCounts = {
            queued: 0, sending: 0, retry_wait: 0, sent: 0, failed: 0, delivery_unknown: 0, canceled: 0
        };
        for (const row of rows) {
            counts[row.status as BroadcastRecipientStatus] = Number(row.count);
        }
        return counts;
    }

    async recomputeBroadcastStatus(broadcastId: string): Promise<void> {
        const counts = await this.getStatusCounts(broadcastId);
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        const pending = counts.queued + counts.sending + counts.retry_wait;

        let status: BroadcastStatus;
        if (pending > 0) {
            status = 'processing';
        } else if (counts.sent === total && total > 0) {
            status = 'completed';
        } else if (total === 0) {
            return; // nada a recalcular ainda
        } else {
            status = 'partial_failed';
        }

        await this.dbPool.query(
            `UPDATE psychotherapy_broadcasts
             SET status = $2,
                 started_at = COALESCE(started_at, CASE WHEN $2 != 'queued' THEN NOW() END),
                 completed_at = CASE WHEN $2 IN ('completed', 'partial_failed') THEN NOW() ELSE completed_at END
             WHERE id = $1 AND status NOT IN ('canceled')`,
            [broadcastId, status]
        );
    }

    async cancelBroadcast(tenantId: string, broadcastId: string): Promise<PsychotherapyBroadcastRecipient[]> {
        const client = await this.dbPool.connect();
        try {
            await client.query('BEGIN');

            const { rows: broadcastRows } = await client.query(
                `UPDATE psychotherapy_broadcasts
                 SET status = 'canceled', canceled_at = NOW()
                 WHERE id = $1 AND tenant_id = $2 AND status IN ('queued', 'processing')
                 RETURNING id`,
                [broadcastId, tenantId]
            );

            if (broadcastRows.length === 0) {
                await client.query('ROLLBACK');
                return [];
            }

            const { rows: recipientRows } = await client.query(
                `UPDATE psychotherapy_broadcast_recipients
                 SET status = 'canceled'
                 WHERE broadcast_id = $1 AND status IN ('queued', 'retry_wait')
                 RETURNING *`,
                [broadcastId]
            );

            await client.query('COMMIT');
            return recipientRows.map(mapRecipient);
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    async findDueRecipients(limit: number): Promise<PsychotherapyBroadcastRecipient[]> {
        const { rows } = await this.dbPool.query(
            `SELECT * FROM psychotherapy_broadcast_recipients
             WHERE status IN ('queued', 'retry_wait') AND next_attempt_at <= NOW()
             ORDER BY next_attempt_at ASC
             LIMIT $1`,
            [limit]
        );
        return rows.map(mapRecipient);
    }

    async findRecipientById(recipientId: string): Promise<PsychotherapyBroadcastRecipient | null> {
        const { rows } = await this.dbPool.query(
            `SELECT * FROM psychotherapy_broadcast_recipients WHERE id = $1`,
            [recipientId]
        );
        return rows[0] ? mapRecipient(rows[0]) : null;
    }

    async claimRecipientForSending(recipientId: string): Promise<PsychotherapyBroadcastRecipient | null> {
        const { rows } = await this.dbPool.query(
            `UPDATE psychotherapy_broadcast_recipients
             SET status = 'sending', attempt_count = attempt_count + 1, locked_at = NOW()
             WHERE id = $1 AND status IN ('queued', 'retry_wait')
             RETURNING *`,
            [recipientId]
        );
        return rows[0] ? mapRecipient(rows[0]) : null;
    }

    async markRecipientSent(recipientId: string): Promise<void> {
        await this.dbPool.query(
            `UPDATE psychotherapy_broadcast_recipients
             SET status = 'sent', sent_at = NOW(), locked_at = NULL
             WHERE id = $1 AND status = 'sending'`,
            [recipientId]
        );
    }

    async markRecipientRetryWait(recipientId: string, nextAttemptAt: Date, errorCode: string, errorMessage: string): Promise<void> {
        await this.dbPool.query(
            `UPDATE psychotherapy_broadcast_recipients
             SET status = 'retry_wait', next_attempt_at = $2, locked_at = NULL,
                 last_error_code = $3, last_error_message = $4
             WHERE id = $1 AND status = 'sending'`,
            [recipientId, nextAttemptAt, errorCode, errorMessage]
        );
    }

    async markRecipientFailed(recipientId: string, errorCode: string, errorMessage: string): Promise<void> {
        await this.dbPool.query(
            `UPDATE psychotherapy_broadcast_recipients
             SET status = 'failed', locked_at = NULL, last_error_code = $2, last_error_message = $3
             WHERE id = $1 AND status = 'sending'`,
            [recipientId, errorCode, errorMessage]
        );
    }

    async expireStaleLeases(leaseMs: number): Promise<number> {
        const { rowCount } = await this.dbPool.query(
            `UPDATE psychotherapy_broadcast_recipients
             SET status = 'delivery_unknown', locked_at = NULL
             WHERE status = 'sending' AND locked_at < NOW() - ($1::text || ' milliseconds')::interval`,
            [leaseMs]
        );
        return rowCount ?? 0;
    }

    async isBroadcastCanceled(broadcastId: string): Promise<boolean> {
        const { rows } = await this.dbPool.query(
            `SELECT 1 FROM psychotherapy_broadcasts WHERE id = $1 AND status = 'canceled'`,
            [broadcastId]
        );
        return rows.length > 0;
    }

    async setPatientOptIn(tenantId: string, patientId: string, optIn: boolean): Promise<void> {
        const { rowCount } = await this.dbPool.query(
            `UPDATE psychotherapy_patients
             SET whatsapp_bulk_opt_in = $3,
                 whatsapp_bulk_opt_in_at = CASE WHEN $3 THEN NOW() ELSE whatsapp_bulk_opt_in_at END,
                 whatsapp_bulk_opt_out_at = CASE WHEN NOT $3 THEN NOW() ELSE whatsapp_bulk_opt_out_at END
             WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
            [patientId, tenantId, optIn]
        );
        if (!rowCount) {
            throw new AppError('Paciente não encontrado.', 404);
        }
    }
}
