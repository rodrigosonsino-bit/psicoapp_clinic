import { injectable, inject } from 'tsyringe';
import { Pool } from 'pg';
import { AppError } from '../../domain/errors/AppError';

export interface ReplaceGroupChargeInput {
    tenantId: string;
    groupPaymentId: string; // ID da cobrança cancelada a ser substituída
    amountCents: number;
    dueDate: string;
}

export interface ReplaceGroupChargeResult {
    newPaymentId: string;
}

@injectable()
export class ReplaceGroupChargeUseCase {
    constructor(@inject(Pool) private readonly dbPool: Pool) {}

    async execute(input: ReplaceGroupChargeInput): Promise<ReplaceGroupChargeResult> {
        const { tenantId, groupPaymentId, amountCents, dueDate } = input;

        if (amountCents <= 0) {
            throw new AppError('O valor deve ser maior que zero.', 400);
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
            throw new AppError('A data de vencimento deve estar no formato YYYY-MM-DD.', 400);
        }

        const client = await this.dbPool.connect();

        try {
            await client.query('BEGIN');

            const paymentResult = await client.query(`
                SELECT id, group_id, patient_id, group_member_id, charge_type, reference_month, status, group_session_record_id, original_amount_cents
                FROM group_payments
                WHERE id = $1 AND tenant_id = $2
                FOR UPDATE
            `, [groupPaymentId, tenantId]);

            if (paymentResult.rows.length === 0) {
                throw new AppError('Cobrança original não encontrada.', 404);
            }

            const originalPayment = paymentResult.rows[0];

            if (originalPayment.status !== 'voided') {
                throw new AppError('Apenas cobranças canceladas/estornadas podem ser substituídas.', 400);
            }

            // Verifica se já existe uma substituição para esta cobrança
            const replacementResult = await client.query(`
                SELECT id FROM group_payments
                WHERE replacement_for_id = $1 AND tenant_id = $2 AND status != 'voided'
            `, [groupPaymentId, tenantId]);

            if (replacementResult.rows.length > 0) {
                throw new AppError('Já existe uma cobrança ativa substituindo esta cobrança.', 409);
            }

            // Cria a nova cobrança
            const insertResult = await client.query(`
                INSERT INTO group_payments (
                    id, tenant_id, group_id, patient_id, group_member_id, charge_type,
                    reference_month, amount_cents, original_amount_cents,
                    status, due_date, group_session_record_id, replacement_for_id
                ) VALUES (
                    gen_random_uuid(), $1, $2, $3, $4, $5,
                    $6, $7, $8,
                    'pending', $9::date, $10, $11
                ) RETURNING id
            `, [
                tenantId,
                originalPayment.group_id,
                originalPayment.patient_id,
                originalPayment.group_member_id,
                originalPayment.charge_type,
                originalPayment.reference_month,
                amountCents,
                originalPayment.original_amount_cents, // Mantém o original da primeira cobrança
                dueDate,
                originalPayment.group_session_record_id,
                groupPaymentId
            ]);

            const newPaymentId = insertResult.rows[0].id;

            await client.query('COMMIT');

            return { newPaymentId };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}
