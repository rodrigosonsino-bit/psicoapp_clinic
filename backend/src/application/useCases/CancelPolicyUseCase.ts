import { injectable, inject } from 'tsyringe';
import { Pool } from 'pg';
import { AppError } from '../../domain/errors/AppError';
import { logger } from '../../infrastructure/logger';

export interface CancelPolicyInput {
    tenantId: string;
    operatorId: string;
    policyId: string;
    reason: string;
}

@injectable()
export class CancelPolicyUseCase {
    constructor(@inject(Pool) private readonly dbPool: Pool) {}

    async execute(input: CancelPolicyInput): Promise<void> {
        const { tenantId, operatorId, policyId, reason } = input;

        if (!tenantId || !operatorId || !policyId || !reason || reason.trim() === '') {
            throw new AppError('Parâmetros inválidos para cancelamento de política.', 400);
        }

        const client = await this.dbPool.connect();

        try {
            await client.query('BEGIN');

            const policyResult = await client.query(`
                SELECT id, valid_from, group_id, patient_id, member_id, billing_type
                FROM therapy_group_member_billing_policies
                WHERE id = $1 AND tenant_id = $2 AND status = 'active'
                FOR UPDATE
            `, [policyId, tenantId]);

            if (policyResult.rows.length === 0) {
                throw new AppError('Política ativa não encontrada.', 404);
            }

            const policy = policyResult.rows[0];

            if (policy.billing_type === 'upfront') {
                throw new AppError('Políticas de curso upfront devem ser revogadas através do processo de reembolso coordenado.', 400);
            }

            // Check if created today (same date as valid_from for simplicity in business rule)
            const isSameDayCorrection = await client.query(`
                SELECT CURRENT_DATE = $1::date as is_today
            `, [policy.valid_from]);

            const isToday = isSameDayCorrection.rows[0].is_today;

            if (isToday) {
                // Correção no mesmo dia: Marca como canceled
                await client.query(`
                    UPDATE therapy_group_member_billing_policies
                    SET status = 'canceled',
                        canceled_at = NOW(),
                        canceled_by = $1,
                        cancel_reason = $2
                    WHERE id = $3
                `, [operatorId, reason.trim(), policyId]);
            } else {
                // Encerramento normal no meio da vigência
                await client.query(`
                    UPDATE therapy_group_member_billing_policies
                    SET valid_until = GREATEST($1::date, CURRENT_DATE - 1)
                    WHERE id = $2
                `, [policy.valid_from, policyId]);
            }

            // Sempre injeta a política sucessora `group_default`
            await client.query(`
                INSERT INTO therapy_group_member_billing_policies (
                    id, tenant_id, group_id, patient_id, member_id,
                    billing_type, valid_from, approved_by, status
                ) VALUES (
                    gen_random_uuid(), $1, $2, $3, $4,
                    'group_default', GREATEST($5::date, CURRENT_DATE), $6, 'active'
                )
            `, [tenantId, policy.group_id, policy.patient_id, policy.member_id, policy.valid_from, operatorId]);

            await client.query('COMMIT');

            logger.info({ tenantId, policyId, isToday }, 'Política cancelada/encerrada com sucesso.');
        } catch (error: any) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}
