import { injectable, inject } from 'tsyringe';
import { Pool } from 'pg';
import { AppError } from '../../domain/errors/AppError';

export interface VoidGroupPaymentInput {
    tenantId: string;
    groupPaymentId: string;
    reason: string;
}

@injectable()
export class VoidGroupPaymentUseCase {
    constructor(@inject(Pool) private readonly dbPool: Pool) {}

    async execute(input: VoidGroupPaymentInput): Promise<void> {
        const { tenantId, groupPaymentId, reason } = input;

        if (!reason || reason.trim().length === 0) {
            throw new AppError('O motivo do estorno/cancelamento é obrigatório.', 400);
        }

        const trimmedReason = reason.trim();
        const client = await this.dbPool.connect();

        try {
            await client.query('BEGIN');

            // 1. Buscar cobrança com lock exclusivo
            const paymentResult = await client.query(`
                SELECT id, status
                FROM group_payments
                WHERE id = $1 AND tenant_id = $2
                FOR UPDATE
            `, [groupPaymentId, tenantId]);

            if (paymentResult.rows.length === 0) {
                throw new AppError('Cobrança não encontrada.', 404);
            }

            const payment = paymentResult.rows[0];

            if (payment.status === 'voided') {
                throw new AppError('Esta cobrança já está cancelada/estornada.', 409);
            }

            // 2. Marcar a cobrança como voided, incluindo voided_by (FK para tenants.id)
            await client.query(`
                UPDATE group_payments
                SET status      = 'voided',
                    voided_at   = NOW(),
                    voided_by   = $1,
                    void_reason = $2,
                    updated_at  = NOW()
                WHERE id = $3
            `, [tenantId, trimmedReason, groupPaymentId]);

            // 3. Se estava paga, estornar o registro correspondente no ledger
            //    A trigger (056) exige voided_at, voided_by e void_reason obrigatoriamente.
            //    rowCount deve ser exatamente 1 — qualquer outro valor é erro grave.
            if (payment.status === 'paid') {
                const ledgerUpdate = await client.query(`
                    UPDATE financial_payments
                    SET status      = 'voided',
                        voided_at   = NOW(),
                        voided_by   = $1,
                        void_reason = $2
                    WHERE group_payment_id = $3
                      AND tenant_id        = $1
                      AND status           = 'confirmed'
                `, [tenantId, trimmedReason, groupPaymentId]);

                if (ledgerUpdate.rowCount !== 1) {
                    throw new AppError(
                        `Falha no estorno do ledger: esperado 1 registro, encontrado ${ledgerUpdate.rowCount}. ` +
                        `A cobrança está marcada como paid mas sem entrada correspondente no ledger. ` +
                        `Rollback executado. Contate o suporte.`,
                        500
                    );
                }
            }

            await client.query('COMMIT');

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}
