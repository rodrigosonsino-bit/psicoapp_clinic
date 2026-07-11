import { Pool, PoolClient } from 'pg';

export interface IncrementPaidSessionsResult {
    paidSessions: number;
    paymentStatus: 'paid' | 'partial' | 'pending';
    appliedSessions: number;
}

/**
 * UPDATE atômico de linha única — soma sessionsToAdd a paid_sessions,
 * limitado ao saldo do mês (expected_sessions - absences), e recalcula
 * payment_status no mesmo statement. Não precisa de SELECT ... FOR UPDATE:
 * um UPDATE de linha única no Postgres já é atômico (o lock da linha é
 * tomado pelo próprio UPDATE), eliminando a race entre escritores
 * concorrentes que um padrão "ler em JS, calcular, escrever" teria.
 *
 * Único caminho de escrita compartilhado entre o endpoint de conciliação
 * bancária e PaymentReceiptHandler (comprovante via WhatsApp) — ver
 * docs/bank-statement-reconciliation-plan.md, seção "Unificação do
 * caminho de escrita em paid_sessions".
 */
export async function incrementPaidSessions(
    client: Pool | PoolClient,
    tenantId: string,
    monthlyRecordId: string,
    sessionsToAdd: number
): Promise<IncrementPaidSessionsResult> {
    const result = await client.query<{
        old_paid_sessions: number;
        paid_sessions: number;
        payment_status: 'paid' | 'partial' | 'pending';
    }>(
        `
        WITH old AS (
            SELECT paid_sessions
            FROM psychotherapy_monthly_records
            WHERE id = $1 AND tenant_id = $2
        ),
        upd AS (
            UPDATE psychotherapy_monthly_records
            SET paid_sessions = LEAST(
                    paid_sessions + $3::int,
                    GREATEST(expected_sessions - absences, 0)
                ),
                payment_status = CASE
                    WHEN LEAST(paid_sessions + $3::int, GREATEST(expected_sessions - absences, 0))
                         >= GREATEST(expected_sessions - absences, 0)
                         AND GREATEST(expected_sessions - absences, 0) > 0
                        THEN 'paid'
                    WHEN LEAST(paid_sessions + $3::int, GREATEST(expected_sessions - absences, 0)) > 0
                        THEN 'partial'
                    ELSE 'pending'
                END,
                updated_at = NOW()
            WHERE id = $1 AND tenant_id = $2
            RETURNING paid_sessions, payment_status
        )
        SELECT old.paid_sessions AS old_paid_sessions, upd.paid_sessions, upd.payment_status
        FROM upd, old;
        `,
        [monthlyRecordId, tenantId, sessionsToAdd]
    );

    const row = result.rows[0];
    if (!row) {
        throw new Error(`psychotherapy_monthly_records não encontrado: id=${monthlyRecordId} tenant=${tenantId}`);
    }

    return {
        paidSessions: row.paid_sessions,
        paymentStatus: row.payment_status,
        appliedSessions: row.paid_sessions - row.old_paid_sessions
    };
}
