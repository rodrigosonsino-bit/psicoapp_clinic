import { injectable, inject } from 'tsyringe';
import { Pool } from 'pg';
import { AppError } from '../../domain/errors/AppError';
import { logger } from '../../infrastructure/logger';

export interface AdvanceInstallmentsInput {
    tenantId: string;
    groupId: string;
    groupMemberId: string;
    monthsToAdvance: number;
}

export interface AdvanceInstallmentsResult {
    createdCount: number;
}

@injectable()
export class AdvanceInstallmentsUseCase {
    constructor(@inject(Pool) private readonly dbPool: Pool) {}

    async execute(input: AdvanceInstallmentsInput): Promise<AdvanceInstallmentsResult> {
        const { tenantId, groupId, groupMemberId, monthsToAdvance } = input;

        if (!tenantId || !groupId || !groupMemberId) {
            throw new AppError('tenantId, groupId e groupMemberId são obrigatórios.', 400);
        }
        if (monthsToAdvance <= 0 || monthsToAdvance > 24) {
            throw new AppError('O número de parcelas a adiantar deve ser entre 1 e 24.', 400);
        }

        const client = await this.dbPool.connect();

        try {
            await client.query('BEGIN');

            // 1. Validar membro e obter política de cobrança vigente hoje. Ausência de
            // política (LEFT JOIN sem match, o caso comum de um membro que nunca teve
            // pacote/isenção) é o padrão "mensal" implícito — precisa de COALESCE, senão
            // billing_type vem NULL e o comparativo abaixo bloqueia todo mundo por engano.
            const memberResult = await client.query(`
                SELECT m.patient_id, COALESCE(p.billing_type, 'group_default') AS billing_type
                FROM therapy_group_members m
                LEFT JOIN LATERAL (
                    SELECT billing_type
                    FROM therapy_group_member_billing_policies bp
                    WHERE bp.member_id = m.id
                      AND bp.tenant_id = $3
                      AND bp.status = 'active'
                      AND bp.valid_from <= CURRENT_DATE
                      AND (bp.valid_until IS NULL OR bp.valid_until >= CURRENT_DATE)
                    ORDER BY bp.valid_from DESC
                    LIMIT 1
                ) p ON true
                WHERE m.id = $1 AND m.group_id = $2 AND m.tenant_id = $3 AND m.left_at IS NULL
            `, [groupMemberId, groupId, tenantId]);

            if (memberResult.rows.length === 0) {
                throw new AppError('Membro não encontrado ou inativo.', 404);
            }

            const member = memberResult.rows[0];
            if (member.billing_type !== 'group_default') {
                throw new AppError('Apenas membros com cobrança mensal padrão podem adiantar parcelas mensais.', 400);
            }

            // 2. Obter valor da mensalidade do grupo
            const groupResult = await client.query(`
                SELECT monthly_fee_cents, is_active 
                FROM therapy_groups 
                WHERE id = $1 AND tenant_id = $2
            `, [groupId, tenantId]);

            if (groupResult.rows.length === 0 || !groupResult.rows[0].is_active) {
                throw new AppError('Grupo não encontrado ou inativo.', 404);
            }

            const group = groupResult.rows[0];
            if (group.monthly_fee_cents === null || group.monthly_fee_cents <= 0) {
                throw new AppError('Este grupo não possui mensalidade fixa.', 400);
            }

            // 3. Determinar o mês inicial
            // Queremos o maior mês gerado a partir do mês atual, ou o mês atual se nenhum foi gerado.
            const currentMonth = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'America/Sao_Paulo',
                year: 'numeric',
                month: '2-digit',
            }).format(new Date()).slice(0, 7);

            const lastChargeResult = await client.query(`
                SELECT MAX(reference_month) as last_month
                FROM group_payments
                WHERE group_member_id = $1 AND tenant_id = $2 
                  AND charge_type = 'monthly' AND status <> 'voided'
                  AND reference_month >= $3
            `, [groupMemberId, tenantId, currentMonth]);

            let startMonth = currentMonth;
            if (lastChargeResult.rows[0].last_month) {
                // Parse the last generated month and add 1 month
                const [yearStr, monthStr] = lastChargeResult.rows[0].last_month.split('-');
                const nextDate = new Date(Number(yearStr), Number(monthStr), 1); // JS months are 0-indexed, so passing monthStr gives the NEXT month!
                const nextMonthStr = String(nextDate.getMonth() + 1).padStart(2, '0');
                const nextYearStr = nextDate.getFullYear();
                startMonth = `${nextYearStr}-${nextMonthStr}`;
            }

            let createdCount = 0;
            let currentIterMonth = startMonth;

            for (let i = 0; i < monthsToAdvance; i++) {
                const dueDate = `${currentIterMonth}-10`; // Arbitrary due date for advance payments

                const result = await client.query(`
                    INSERT INTO group_payments (
                        id, tenant_id, group_id, patient_id, group_member_id,
                        charge_type, reference_month, amount_cents, original_amount_cents,
                        status, due_date
                    ) VALUES (
                        gen_random_uuid(), $1, $2, $3, $4,
                        'monthly', $5, $6, $6,
                        'pending', $7
                    )
                    ON CONFLICT (tenant_id, group_member_id, reference_month)
                    WHERE charge_type = 'monthly' AND status <> 'voided'
                    DO NOTHING
                `, [
                    tenantId, groupId, member.patient_id, groupMemberId,
                    currentIterMonth, group.monthly_fee_cents, dueDate
                ]);

                if (result.rowCount && result.rowCount > 0) {
                    createdCount++;
                }

                // Increment month
                const [y, m] = currentIterMonth.split('-');
                const d = new Date(Number(y), Number(m), 1);
                const nextM = String(d.getMonth() + 1).padStart(2, '0');
                const nextY = d.getFullYear();
                currentIterMonth = `${nextY}-${nextM}`;
            }

            await client.query('COMMIT');
            logger.info({ tenantId, groupMemberId, createdCount }, 'Parcelas adiantadas com sucesso.');

            return { createdCount };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}
