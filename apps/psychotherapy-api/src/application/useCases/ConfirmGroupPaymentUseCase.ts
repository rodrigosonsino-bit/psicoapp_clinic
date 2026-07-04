import { injectable, inject } from 'tsyringe';
import { Pool } from 'pg';
import { AppError } from '../../domain/errors/AppError';

function mapPaymentMethod(method: string): string {
    switch (method) {
        case 'pix':         return 'pix';
        case 'cash':        return 'cash';
        case 'debit_card':  return 'credit_card';
        case 'credit_card': return 'credit_card';
        default:            return 'other';
    }
}

export interface ConfirmGroupPaymentInput {
    tenantId: string;
    operatorId: string;
    groupPaymentId: string;
    paymentMethod: 'pix' | 'cash' | 'debit_card' | 'credit_card';
    amountPaidCents?: number;
    /** Crédito líquido que efetivamente cai na conta, após taxa da adquirente. Se omitido,
     *  assume-se igual ao valor pago (taxa zero) — caso comum de dinheiro/Pix sem taxa. */
    netAmountCents?: number;
    observations?: string;
    /** Auditoria da sugestão de taxa exibida no modal — não recalculada nem validada aqui,
     *  a fonte da verdade financeira continua sendo netAmountCents. */
    cardInstallments?: number;
    appliedFeeBps?: number;
}

@injectable()
export class ConfirmGroupPaymentUseCase {
    constructor(@inject(Pool) private readonly dbPool: Pool) {}

    async execute(input: ConfirmGroupPaymentInput): Promise<void> {
        const { tenantId, operatorId, groupPaymentId, paymentMethod, amountPaidCents, netAmountCents, observations, cardInstallments, appliedFeeBps } = input;

        if (!tenantId || !operatorId || !groupPaymentId) {
            throw new AppError('tenantId, operatorId e groupPaymentId são obrigatórios.', 400);
        }

        const client = await this.dbPool.connect();

        try {
            await client.query('BEGIN');

            const paymentResult = await client.query(`
                SELECT id, patient_id, group_id, group_member_id, amount_cents, status, charge_type
                FROM group_payments
                WHERE id = $1 AND tenant_id = $2
                FOR UPDATE
            `, [groupPaymentId, tenantId]);

            if (paymentResult.rows.length === 0) {
                throw new AppError('Cobrança não encontrada.', 404);
            }

            const payment = paymentResult.rows[0];

            if (payment.status === 'voided') {
                throw new AppError('Esta cobrança foi cancelada e não pode ser confirmada.', 409);
            }

            const finalAmountPaid = amountPaidCents !== undefined ? amountPaidCents : payment.amount_cents;

            if (finalAmountPaid <= 0) {
                throw new AppError('O valor pago deve ser maior que zero.', 400);
            }

            // Líquido = o que efetivamente cai na conta. Sem taxa informada, líquido = bruto.
            const finalNetAmount = netAmountCents !== undefined ? netAmountCents : finalAmountPaid;

            if (finalNetAmount <= 0) {
                throw new AppError('O valor líquido creditado deve ser maior que zero.', 400);
            }
            if (finalNetAmount > finalAmountPaid) {
                throw new AppError('O valor líquido não pode ser maior que o valor pago (taxa não pode ser negativa).', 400);
            }

            const processingFeeCents = finalAmountPaid - finalNetAmount;

            const idempotencyKey = `group_confirm_${groupPaymentId}`;
            const ledgerMethod = mapPaymentMethod(paymentMethod);

            let financialPaymentId: string | null = null;

            if (payment.status === 'paid') {
                const existing = await client.query(`
                    SELECT id, patient_id, group_payment_id, amount_cents, net_amount_cents, method, tenant_id
                    FROM financial_payments
                    WHERE tenant_id = $1 AND idempotency_key = $2
                `, [tenantId, idempotencyKey]);

                if (existing.rows.length === 0) {
                    throw new AppError('Estado inconsistente: cobrança está paga mas sem registro no ledger.', 500);
                }

                const fp = existing.rows[0];
                if (
                    fp.patient_id       !== payment.patient_id ||
                    fp.group_payment_id !== groupPaymentId      ||
                    fp.tenant_id        !== tenantId            ||
                    fp.amount_cents     !== finalAmountPaid     ||
                    fp.net_amount_cents !== finalNetAmount      ||
                    fp.method           !== ledgerMethod
                ) {
                    throw new AppError('Conflito de idempotência: registro no ledger diverge (bruto, líquido ou método).', 409);
                }

                financialPaymentId = fp.id;
            } else {
                await client.query(`
                    UPDATE group_payments
                    SET status              = 'paid',
                        paid_at             = NOW(),
                        payment_method      = $1,
                        amount_paid_cents   = $2,
                        net_amount_cents    = $3,
                        processing_fee_cents = $4,
                        original_amount_cents = COALESCE(original_amount_cents, amount_cents),
                        notes               = $5,
                        card_installments   = $7,
                        applied_fee_bps     = $8,
                        updated_at          = NOW()
                    WHERE id = $6
                `, [paymentMethod, finalAmountPaid, finalNetAmount, processingFeeCents, observations || null, groupPaymentId, cardInstallments ?? null, appliedFeeBps ?? null]);

                // DO NOTHING (não DO UPDATE): campos de valor são imutáveis no ledger (trigger
                // 080) — uma tentativa concorrente com valores diferentes precisa retornar 409
                // explícito abaixo, nunca sobrescrever silenciosamente o registro já gravado.
                const ledgerInsert = await client.query(`
                    INSERT INTO financial_payments (
                        id, tenant_id, patient_id, monthly_record_id,
                        amount_cents, net_amount_cents, processing_fee_cents,
                        card_installments, applied_fee_bps,
                        currency, paid_at, method, source, status,
                        idempotency_key, created_by, group_payment_id
                    ) VALUES (
                        gen_random_uuid(), $1, $2, NULL,
                        $3, $4, $5,
                        $9, $10,
                        'BRL', NOW(), $6, 'manual', 'confirmed',
                        $7, $1, $8
                    )
                    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
                    RETURNING id
                `, [tenantId, payment.patient_id, finalAmountPaid, finalNetAmount, processingFeeCents, ledgerMethod, idempotencyKey, groupPaymentId, cardInstallments ?? null, appliedFeeBps ?? null]);

                if (ledgerInsert.rowCount === 0) {
                    const existing = await client.query(`
                        SELECT id, patient_id, group_payment_id, amount_cents, net_amount_cents, method, tenant_id
                        FROM financial_payments
                        WHERE tenant_id = $1 AND idempotency_key = $2
                    `, [tenantId, idempotencyKey]);

                    const fp = existing.rows[0];
                    if (
                        fp.patient_id       !== payment.patient_id ||
                        fp.group_payment_id !== groupPaymentId      ||
                        fp.amount_cents     !== finalAmountPaid      ||
                        fp.net_amount_cents !== finalNetAmount       ||
                        fp.method           !== ledgerMethod         ||
                        fp.tenant_id        !== tenantId
                    ) {
                        throw new AppError('Conflito de idempotência: registro no ledger diverge (bruto, líquido ou método).', 409);
                    }
                    financialPaymentId = fp.id;
                } else {
                    financialPaymentId = ledgerInsert.rows[0].id;
                }
            }

            // Ativação da política se for curso à vista
            if (payment.charge_type === 'course_upfront') {
                if (!financialPaymentId) throw new AppError('Erro ao recuperar o ledger do curso à vista.', 500);

                // Encerra política atual se houver
                await client.query(`
                    UPDATE therapy_group_member_billing_policies
                    SET valid_until = CURRENT_DATE - 1
                    WHERE tenant_id = $1 AND member_id = $2 AND status = 'active'
                `, [tenantId, payment.group_member_id]);

                // Insere nova política upfront
                await client.query(`
                    INSERT INTO therapy_group_member_billing_policies (
                        id, tenant_id, group_id, patient_id, member_id,
                        billing_type, valid_from, approved_by, status,
                        upfront_payment_id
                    ) VALUES (
                        gen_random_uuid(), $1, $2, $3, $4,
                        'upfront', CURRENT_DATE, $5, 'active',
                        $6
                    )
                `, [tenantId, payment.group_id, payment.patient_id, payment.group_member_id, operatorId, financialPaymentId]);

                // Anula SOMENTE as mensalidades pendentes ainda não vencidas (due_date >= hoje)
                // — o saldo cobrado no upfront (CreateUpfrontCourseChargeUseCase) já é calculado
                // como "total do curso menos o que já foi pago", então essas mensalidades futuras
                // ficam substituídas pelo pagamento à vista. Inadimplência ANTERIOR (due_date no
                // passado) não é tocada — continua como dívida separada, exige decisão manual.
                await client.query(`
                    UPDATE group_payments
                    SET status      = 'voided',
                        voided_at   = NOW(),
                        voided_by   = $1,
                        void_reason = 'Substituído por pagamento à vista do curso',
                        updated_at  = NOW()
                    WHERE tenant_id = $1
                      AND group_member_id = $2
                      AND charge_type = 'monthly'
                      AND status = 'pending'
                      AND due_date >= CURRENT_DATE
                `, [tenantId, payment.group_member_id]);
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
