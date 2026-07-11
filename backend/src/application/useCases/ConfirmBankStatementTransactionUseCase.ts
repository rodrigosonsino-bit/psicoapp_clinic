import { injectable, inject } from 'tsyringe';
import { Pool } from 'pg';
import { AppError } from '../../domain/errors/AppError';
import { incrementPaidSessions } from '../../infrastructure/db/incrementPaidSessions';

const PIX_DUPLICATE_WINDOW_DAYS = 3;

export interface ConfirmBankStatementTransactionResult {
    transactionId: string;
    confirmedSessions: number;
    paidSessions: number;
    paymentStatus: 'paid' | 'partial' | 'pending';
}

/**
 * Confirmação atômica de uma transação de extrato bancário → baixa de
 * sessões pagas. Todos os 4 gates (paciente válido, duplicata Pix, cutover,
 * valor exato) rodam dentro da MESMA transação SQL — nenhum gera efeito
 * colateral parcial se um posterior falhar.
 *
 * Ver docs/bank-statement-reconciliation-plan.md, seção 5 (histórico de
 * correções: v3->v4 fechou a contradição de status/constraint; v4->v5
 * fechou o TOCTOU real com o webhook Pix).
 */
@injectable()
export class ConfirmBankStatementTransactionUseCase {
    constructor(@inject(Pool) private readonly dbPool: Pool) {}

    async execute(params: {
        tenantId: string;
        transactionId: string;
        patientId: string;
        month: string; // 'YYYY-MM'
    }): Promise<ConfirmBankStatementTransactionResult> {
        const { tenantId, transactionId, patientId, month } = params;
        const client = await this.dbPool.connect();

        try {
            await client.query('BEGIN');

            // 1. Trava a transação importada SEM mudar status ainda (evita a
            // contradição com bank_stmt_tx_state_integrity — a transição pra
            // 'confirmed' só acontece no passo 8, já com todos os campos).
            const lockRes = await client.query<{
                id: string; amount_cents: number; posted_at: string;
            }>(
                `SELECT id, amount_cents, posted_at
                 FROM psychotherapy_bank_statement_transactions
                 WHERE id = $1 AND tenant_id = $2 AND status = 'pending'
                 FOR UPDATE`,
                [transactionId, tenantId]
            );

            const bankTx = lockRes.rows[0];
            if (!bankTx) {
                throw new AppError('Transação já confirmada ou ignorada por outra requisição.', 409);
            }

            // 2. Revalida o paciente no momento do commit (não confia na
            // sugestão do momento do import, que pode estar desatualizada).
            const patientRes = await client.query(
                `SELECT id FROM psychotherapy_patients
                 WHERE id = $1 AND tenant_id = $2
                   AND individual_therapy_enabled = TRUE
                   AND status != 'inactive'
                   AND deleted_at IS NULL
                 FOR UPDATE`,
                [patientId, tenantId]
            );
            if (patientRes.rowCount === 0) {
                throw new AppError('Paciente inválido, inativo ou não-individual (grupo).', 422);
            }

            // 3. Gate de duplicata Pix — trava candidatos pending OU paid (não só
            // paid) pra fechar o TOCTOU contra o webhook Pix concorrente.
            const pixRes = await client.query(
                `SELECT id FROM psychotherapy_pix_charges
                 WHERE tenant_id = $1 AND patient_id = $2 AND amount_cents = $3
                   AND status IN ('pending', 'paid')
                   AND (
                     status = 'pending'
                     OR paid_at BETWEEN $4::date - INTERVAL '${PIX_DUPLICATE_WINDOW_DAYS} days'
                                     AND $4::date + INTERVAL '${PIX_DUPLICATE_WINDOW_DAYS} days'
                   )
                 FOR UPDATE`,
                [tenantId, patientId, bankTx.amount_cents, bankTx.posted_at]
            );
            if ((pixRes.rowCount ?? 0) > 0) {
                throw new AppError(
                    'Existe cobrança Pix relacionada a este paciente/valor — resolva pelo fluxo Pix antes de confirmar aqui.',
                    409
                );
            }

            // 4. Gate de cutover financeiro — recusa com erro explícito em vez de
            // deixar um sync futuro apagar a baixa silenciosamente.
            const cutoverRes = await client.query<{ cutover_at: string }>(
                `SELECT cutover_at FROM tenant_financial_cutovers
                 WHERE tenant_id = $1 AND status = 'approved'`,
                [tenantId]
            );
            const cutoverAt = cutoverRes.rows[0]?.cutover_at;
            if (cutoverAt) {
                const monthStart = `${month}-01`;
                const isPostCutover = await client.query<{ is_post: boolean }>(
                    `SELECT $1::date >= $2::date AS is_post`,
                    [monthStart, cutoverAt]
                );
                if (isPostCutover.rows[0]?.is_post) {
                    throw new AppError(
                        'Mês pós-cutover financeiro — use o fluxo de ledger financeiro em vez desta ferramenta.',
                        409
                    );
                }
            }

            // 5. Busca o registro mensal (não cria — precisa já existir via
            // Faturamento Mensal/"Gerar Mês", que calcula expected_sessions
            // corretamente a partir dos agendamentos reais).
            const recordRes = await client.query<{
                id: string; session_price_cents: number | null; expected_amount_cents: number | null;
                expected_sessions: number; absences: number; paid_sessions: number;
                payment_type: 'monthly' | 'per_session' | null;
            }>(
                `SELECT id, session_price_cents, expected_amount_cents, expected_sessions,
                        absences, paid_sessions, payment_type
                 FROM psychotherapy_monthly_records
                 WHERE tenant_id = $1 AND patient_id = $2 AND month = $3
                 FOR UPDATE`,
                [tenantId, patientId, month]
            );
            const record = recordRes.rows[0];
            if (!record) {
                throw new AppError(
                    `Registro mensal não existe para ${month} — gere o mês no Faturamento Mensal antes de confirmar.`,
                    422
                );
            }

            // 6. Deriva sessions ESTRITAMENTE do valor da transação — nunca de
            // um valor vindo do payload do cliente.
            const saldo = Math.max(record.expected_sessions - record.absences - record.paid_sessions, 0);
            let sessions: number | null = null;

            if (record.payment_type === 'per_session') {
                const price = record.session_price_cents;
                if (price && price > 0 && bankTx.amount_cents % price === 0) {
                    const computed = bankTx.amount_cents / price;
                    if (computed >= 1 && computed <= saldo) sessions = computed;
                }
            } else if (record.payment_type === 'monthly') {
                if (record.expected_amount_cents && bankTx.amount_cents === record.expected_amount_cents) {
                    sessions = saldo;
                }
            }

            if (sessions === null) {
                throw new AppError(
                    'Valor da transação não bate exato com o preço da sessão/mensalidade, ou excede o saldo do mês — confirme manualmente pelo Faturamento Mensal.',
                    422
                );
            }

            // 7. UPDATE atômico de paid_sessions (mesmo helper usado por
            // PaymentReceiptHandler — elimina a race entre os dois caminhos
            // automáticos de escrita).
            const incrementResult = await incrementPaidSessions(client, tenantId, record.id, sessions);

            // 8. Transição final: 'pending' -> 'confirmed', já com todos os
            // campos exigidos pela constraint preenchidos na mesma UPDATE.
            const finalRes = await client.query(
                `UPDATE psychotherapy_bank_statement_transactions
                 SET status = 'confirmed',
                     confirmed_patient_id = $1,
                     confirmed_month = $2,
                     confirmed_sessions = $3,
                     confirmed_at = NOW(),
                     confirmed_by = $4
                 WHERE id = $5 AND tenant_id = $4 AND status = 'pending'
                 RETURNING id`,
                [patientId, month, sessions, tenantId, transactionId]
            );
            if (finalRes.rowCount === 0) {
                // Não deveria acontecer (já travamos a linha no passo 1), mas
                // falha de forma explícita em vez de assumir sucesso.
                throw new AppError('Falha ao confirmar a transação — estado mudou durante o processamento.', 409);
            }

            await client.query('COMMIT');

            return {
                transactionId,
                confirmedSessions: sessions,
                paidSessions: incrementResult.paidSessions,
                paymentStatus: incrementResult.paymentStatus
            };
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }
}
