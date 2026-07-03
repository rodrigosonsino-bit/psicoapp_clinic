import { injectable, inject } from 'tsyringe';
import { Pool } from 'pg';
import { AppError } from '../../domain/errors/AppError';
import { logger } from '../../infrastructure/logger';
import { randomUUID } from 'crypto';

export interface RefundUpfrontCourseInput {
    tenantId: string;
    operatorId: string; // operator doing the refund
    groupPaymentId: string; // The course_upfront group payment
    reason: string;
}

export interface RefundUpfrontCourseResult {
    success: boolean;
    refundId: string;
    amountCents: number;
}

@injectable()
export class RefundUpfrontCourseUseCase {
    constructor(@inject(Pool) private readonly dbPool: Pool) {}

    async execute(input: RefundUpfrontCourseInput): Promise<RefundUpfrontCourseResult> {
        const { tenantId, operatorId, groupPaymentId, reason } = input;

        if (!tenantId || !operatorId || !groupPaymentId || !reason || reason.trim() === '') {
            throw new AppError('Parâmetros inválidos para reembolso.', 400);
        }

        const client = await this.dbPool.connect();

        try {
            await client.query('BEGIN');

            // 1 & 2: Lock financial_payments and group_payments
            // Join to find the confirmed financial payment for this group payment
            const fpResult = await client.query(`
                SELECT fp.id as financial_payment_id, fp.amount_cents, gp.group_member_id, gp.group_id, gp.patient_id
                FROM financial_payments fp
                JOIN group_payments gp ON gp.id = fp.group_payment_id
                WHERE gp.id = $1 AND fp.tenant_id = $2 AND gp.charge_type = 'course_upfront' AND fp.status = 'confirmed'
                FOR UPDATE OF fp, gp
            `, [groupPaymentId, tenantId]);

            if (fpResult.rows.length === 0) {
                throw new AppError('Pagamento upfront não encontrado ou não está confirmado.', 404);
            }

            const paymentData = fpResult.rows[0];
            const financialPaymentId = paymentData.financial_payment_id;
            const amountCents = paymentData.amount_cents;
            const groupMemberId = paymentData.group_member_id;
            const patientId = paymentData.patient_id;
            const groupId = paymentData.group_id;

            // 3. Lock original policy
            const policyResult = await client.query(`
                SELECT id, valid_from
                FROM therapy_group_member_billing_policies
                WHERE upfront_payment_id = $1 AND tenant_id = $2 AND status = 'active'
                FOR UPDATE
            `, [financialPaymentId, tenantId]);

            if (policyResult.rows.length === 0) {
                throw new AppError('Política ativa associada a este pagamento não encontrada.', 404);
            }
            
            const policyId = policyResult.rows[0].id;
            const validFrom = policyResult.rows[0].valid_from;

            // 4. Insert into upfront_refunds (status pending)
            const refundId = randomUUID();
            const idempotencyKey = randomUUID();

            await client.query(`
                INSERT INTO upfront_refunds (
                    id, tenant_id, payment_id, policy_id, status, 
                    reason, operator_id, amount_cents, idempotency_key
                ) VALUES (
                    $1, $2, $3, $4, 'pending',
                    $5, $6, $7, $8
                )
            `, [refundId, tenantId, financialPaymentId, policyId, reason.trim(), operatorId, amountCents, idempotencyKey]);

            // 5. End policy (reduce valid_until)
            // We set it to yesterday, or valid_from if created today.
            await client.query(`
                UPDATE therapy_group_member_billing_policies
                SET valid_until = GREATEST($1::date, CURRENT_DATE - 1)
                WHERE id = $2
            `, [validFrom, policyId]);

            // 6. Insert successor policy (group_default)
            // It will be valid starting from GREATEST(valid_from, CURRENT_DATE)
            await client.query(`
                INSERT INTO therapy_group_member_billing_policies (
                    id, tenant_id, group_id, patient_id, member_id,
                    billing_type, valid_from, approved_by, status
                ) VALUES (
                    gen_random_uuid(), $1, $2, $3, $4,
                    'group_default', GREATEST($5::date, CURRENT_DATE), $6, 'active'
                )
            `, [tenantId, groupId, patientId, groupMemberId, validFrom, operatorId]);

            // 7. Void ledger (trigger trg_prevent_void_upfront_ledger will consume the pending refund)
            await client.query(`
                UPDATE financial_payments
                SET status = 'voided'
                WHERE id = $1
            `, [financialPaymentId]);

            // Void group payment
            await client.query(`
                UPDATE group_payments
                SET status = 'voided'
                WHERE id = $1
            `, [groupPaymentId]);

            await client.query('COMMIT');

            logger.info({ tenantId, refundId, financialPaymentId }, 'Reembolso upfront de curso efetuado com sucesso.');

            return { success: true, refundId, amountCents };

        } catch (error: any) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}
