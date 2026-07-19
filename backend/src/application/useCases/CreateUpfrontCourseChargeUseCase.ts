import { injectable, inject } from 'tsyringe';
import { Pool } from 'pg';
import { AppError } from '../../domain/errors/AppError';
import { logger } from '../../infrastructure/logger';

export interface CreateUpfrontCourseChargeInput {
    tenantId: string;
    groupId: string;
    groupMemberId: string;
    operatorId: string;
    overrideTotalCents?: number;
}

export interface CreateUpfrontCourseChargeResult {
    chargeId: string;
    amountCents: number;
}

@injectable()
export class CreateUpfrontCourseChargeUseCase {
    constructor(@inject(Pool) private readonly dbPool: Pool) {}

    async execute(input: CreateUpfrontCourseChargeInput): Promise<CreateUpfrontCourseChargeResult> {
        const { tenantId, groupId, groupMemberId, operatorId, overrideTotalCents } = input;

        if (!tenantId || !groupId || !groupMemberId || !operatorId) {
            throw new AppError('tenantId, groupId, groupMemberId e operatorId são obrigatórios.', 400);
        }

        const client = await this.dbPool.connect();

        try {
            await client.query('BEGIN');

            // 1. Validar membro ativo
            const memberResult = await client.query(`
                SELECT patient_id FROM therapy_group_members
                WHERE id = $1 AND tenant_id = $2 AND group_id = $3 AND left_at IS NULL
            `, [groupMemberId, tenantId, groupId]);

            if (memberResult.rows.length === 0) {
                throw new AppError('Matrícula (membro) não encontrada ou inativa.', 404);
            }
            const patientId = memberResult.rows[0].patient_id;

            // 2. Buscar o comercial do grupo
            const groupResult = await client.query(`
                SELECT session_price_cents, duration_months, monthly_fee_cents 
                FROM therapy_groups
                WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
            `, [groupId, tenantId]);

            if (groupResult.rows.length === 0) {
                throw new AppError('Grupo não encontrado.', 404);
            }

            const group = groupResult.rows[0];

            // Regra do valor do curso: por padrão, cobra o SALDO RESTANTE (valor cheio do
            // curso menos o que já foi pago via mensalidades), nunca o valor cheio de novo —
            // senão um aluno que já pagou alguns meses seria cobrado em duplicidade ao migrar
            // pra pagamento à vista. overrideTotalCents ignora esse cálculo propositalmente
            // (renegociação explícita e auditada pelo operador, não é o caminho automático).
            let totalCents = 0;
            if (overrideTotalCents !== undefined && overrideTotalCents > 0) {
                totalCents = overrideTotalCents;
            } else {
                if (group.duration_months && group.monthly_fee_cents) {
                    const fullCourseCents = group.monthly_fee_cents * group.duration_months;

                    const paidMonthlyResult = await client.query(`
                        SELECT COALESCE(SUM(amount_paid_cents), 0) AS total
                        FROM group_payments
                        WHERE tenant_id = $1 AND group_member_id = $2
                          AND charge_type = 'monthly' AND status = 'paid'
                    `, [tenantId, groupMemberId]);
                    const alreadyPaidCents = Number(paidMonthlyResult.rows[0].total);

                    totalCents = fullCourseCents - alreadyPaidCents;

                    if (totalCents <= 0) {
                        throw new AppError(
                            'O aluno já pagou, via mensalidades, valor igual ou maior que o total do curso — ' +
                            'não há saldo restante para cobrança à vista. Para renegociar mesmo assim, ' +
                            'informe overrideTotalCents explicitamente.',
                            409
                        );
                    }
                } else {
                    throw new AppError('Não foi possível calcular o valor do curso (grupo sem mensalidade fixa com duração). Envie overrideTotalCents.', 400);
                }
            }

            // 3. Criar a cobrança upfront
            // reference_month é NOT NULL na tabela mas não tem significado pra course_upfront
            // (GroupController.listGroupPayments casa esse charge_type pelo mês de paid_at, não
            // por reference_month) — usa o mês corrente só pra satisfazer a constraint.
            const chargeResult = await client.query(`
                INSERT INTO group_payments (
                    id, tenant_id, group_id, patient_id, group_member_id,
                    charge_type, reference_month, original_amount_cents, amount_cents,
                    status, due_date
                ) VALUES (
                    gen_random_uuid(), $1, $2, $3, $4,
                    'course_upfront', TO_CHAR(CURRENT_DATE, 'YYYY-MM'), $5, $5,
                    'pending', CURRENT_DATE
                ) RETURNING id
            `, [tenantId, groupId, patientId, groupMemberId, totalCents]);

            await client.query('COMMIT');

            logger.info({ tenantId, groupMemberId, chargeId: chargeResult.rows[0].id }, 'Cobrança upfront de curso criada com sucesso.');

            return {
                chargeId: chargeResult.rows[0].id,
                amountCents: totalCents
            };
        } catch (error: any) {
            await client.query('ROLLBACK');
            if (error.constraint === 'uq_group_payments_upfront_active') {
                throw new AppError('Já existe uma cobrança upfront ativa (pending ou paid) para esta matrícula.', 409);
            }
            throw error;
        } finally {
            client.release();
        }
    }
}
