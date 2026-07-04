import { injectable, inject } from 'tsyringe';
import { Pool } from 'pg';
import { AppError } from '../../domain/errors/AppError';
import { logger } from '../../infrastructure/logger';

export interface CreateGroupChargesInput {
    tenantId: string;
    groupId: string;
    referenceMonth: string; // YYYY-MM
    dueDate: string; // YYYY-MM-DD
}

export interface CreateGroupChargesResult {
    createdCount: number;
    skippedCount: number;
}

@injectable()
export class CreateGroupChargesUseCase {
    constructor(@inject(Pool) private readonly dbPool: Pool) {}

    async execute(input: CreateGroupChargesInput): Promise<CreateGroupChargesResult> {
        const { tenantId, groupId, referenceMonth, dueDate } = input;

        if (!/^\d{4}-\d{2}$/.test(referenceMonth)) {
            throw new AppError('referenceMonth deve estar no formato YYYY-MM.', 400);
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
            throw new AppError('dueDate deve estar no formato YYYY-MM-DD.', 400);
        }

        const client = await this.dbPool.connect();

        try {
            await client.query('BEGIN');

            // 1. Validar grupo e obter valor da mensalidade
            const groupResult = await client.query(`
                SELECT id, monthly_fee_cents, is_active 
                FROM therapy_groups 
                WHERE id = $1 AND tenant_id = $2
            `, [groupId, tenantId]);

            if (groupResult.rows.length === 0) {
                throw new AppError('Grupo não encontrado.', 404);
            }

            const group = groupResult.rows[0];
            if (!group.is_active) {
                throw new AppError('Não é possível gerar cobranças para um grupo inativo.', 400);
            }
            if (group.monthly_fee_cents === null || group.monthly_fee_cents <= 0) {
                throw new AppError('Este grupo não possui mensalidade fixa. As cobranças são geradas por sessão.', 400);
            }

            // 2. Buscar membros ativos e suas políticas vigentes no 1º dia do mês
            // Data de referência baseada no fuso do tenant (simplificado assumindo YYYY-MM-01 local).
            const firstDayOfMonth = `${referenceMonth}-01`;

            const membersResult = await client.query(`
                SELECT m.id as group_member_id, m.patient_id, p.billing_type
                FROM therapy_group_members m
                LEFT JOIN therapy_group_member_billing_policies p 
                  ON p.member_id = m.id 
                 AND p.status = 'active'
                 AND p.valid_from < ($3::date + INTERVAL '1 month') 
                 AND (p.valid_until IS NULL OR p.valid_until >= $3::date)
                WHERE m.group_id = $1 
                  AND m.tenant_id = $2
                  AND (m.left_at IS NULL OR m.left_at >= $3::date)
                  AND m.joined_at < ($3::date + INTERVAL '1 month')
            `, [groupId, tenantId, firstDayOfMonth]);

            if (membersResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return { createdCount: 0, skippedCount: 0 };
            }

            let createdCount = 0;
            let skippedCount = 0;

            for (const row of membersResult.rows) {
                if (!row.billing_type) {
                    throw new AppError(`Falha de integridade: Matrícula ${row.group_member_id} não possui política de faturamento vigente em ${firstDayOfMonth}.`, 500);
                }

                if (row.billing_type !== 'group_default') {
                    // Isento ou pagou upfront, não gera mensalidade
                    skippedCount++;
                    continue;
                }

                // Cria cobrança mensal
                // ON CONFLICT: uq_group_payments_monthly_active 
                // ON group_payments(tenant_id, group_member_id, reference_month) WHERE charge_type = 'monthly' AND status <> 'voided'
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
                    tenantId, groupId, row.patient_id, row.group_member_id,
                    referenceMonth, group.monthly_fee_cents, dueDate
                ]);

                if (result.rowCount && result.rowCount > 0) {
                    createdCount++;
                } else {
                    skippedCount++;
                }
            }

            await client.query('COMMIT');
            
            logger.info({ tenantId, groupId, referenceMonth, createdCount, skippedCount }, 'Cobranças mensais geradas com sucesso.');

            return { createdCount, skippedCount };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}
