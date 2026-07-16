import { Pool } from 'pg';
import crypto from 'crypto';
import { PendingDetails, PendingPatientDetail, PendingSessionDetail, SaveMonthlyRecordDTO, SaveReceiptDTO, RegisterPaymentDTO, FinancialPayment } from '../../domain/repositories/IPsychotherapyRepository';
import { PsychotherapyMonthlyRecord } from '../../domain/models/PsychotherapyMonthlyRecord';
import { PsychotherapyReceipt } from '../../domain/models/PsychotherapyReceipt';
import { NotFoundError } from '../../domain/errors/NotFoundError';
import { AppError } from '../../domain/errors/AppError';
import { validateTenantId, mapMonthlyRecord, mapReceipt, toMonthStr } from './shared';
import { syncMonthlyRecord } from './MonthlyRecordSynchronizer';

/**
 * Extraído de PostgresPsychotherapyRepository, preservando exatamente a lógica original.
 * `getPendingDetails` e `listCoveredAppointmentIds` são COMPLEXO-LEITURA (sem risco de escrita,
 * mas cruzam billing + appointments via `computeCoveredSessions`) — não são "folha" de um
 * domínio só. `saveMonthlyRecord` é COMPLEXO — não abre transação própria, mas chama
 * `syncMonthlyRecord` (fora de transação, via `this.dbPool`) quando `data.patientId` presente.
 * `deleteReceipt` é COMPLEXO — transação própria que deleta o recibo e o `financial_payments`
 * vinculado (dual-write reverso do que `saveReceipt` faz, que ainda permanece no arquivo
 * principal por enquanto).
 * Ver .claude/plans/pendencias-tecnicas-pos-quitacao-2026-07.md (item 1) e
 * .claude/plans/classificacao-postgres-psychotherapy-repository.md.
 */
export class PostgresBillingRepository {
    constructor(private readonly dbPool: Pool) {}

    async registerPayment(data: RegisterPaymentDTO): Promise<FinancialPayment> {
        const validTenantId = validateTenantId(data.tenantId);
        const client = await this.dbPool.connect();
        try {
            await client.query('BEGIN');

            // 1. Verificar chave de idempotência
            const existRes = await client.query(`
                SELECT * FROM financial_payments
                WHERE tenant_id = $1 AND idempotency_key = $2;
            `, [validTenantId, data.idempotencyKey]);

            if (existRes.rows.length > 0) {
                await client.query('COMMIT');
                return this.mapFinancialPayment(existRes.rows[0]);
            }

            // 2. Lock monthly record if provided
            let monthlyRecordId = data.monthlyRecordId || null;
            if (monthlyRecordId) {
                const lockRes = await client.query(`
                    SELECT id FROM psychotherapy_monthly_records
                    WHERE id = $1 FOR UPDATE;
                `, [monthlyRecordId]);
                if (lockRes.rows.length === 0) {
                    throw new NotFoundError('Registro mensal não encontrado');
                }
            }

            // 3. Inserir pagamento
            // net_amount_cents/processing_fee_cents são NOT NULL desde a migration 080 (chk_fin_math
            // exige net+fee=amount) — sem taxa informada, assume net=amount/fee=0 (mesma convenção
            // do backfill daquela migration). Validado aqui com erro claro em vez de deixar a
            // constraint do banco estourar sem contexto.
            const netAmountCents = data.netAmountCents ?? data.amountCents;
            const processingFeeCents = data.processingFeeCents ?? 0;
            if (netAmountCents + processingFeeCents !== data.amountCents) {
                throw new AppError('netAmountCents + processingFeeCents deve ser igual a amountCents', 400);
            }

            const id = data.id || crypto.randomUUID();
            const payRes = await client.query(`
                INSERT INTO financial_payments (
                    id, tenant_id, patient_id, monthly_record_id, amount_cents,
                    net_amount_cents, processing_fee_cents,
                    currency, paid_at, method, source, status, provider_txid,
                    idempotency_key, created_by
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'BRL', $8, $9, $10, 'confirmed', $11, $12, $13)
                RETURNING *;
            `, [
                id, validTenantId, data.patientId, monthlyRecordId, data.amountCents,
                netAmountCents, processingFeeCents,
                data.paidAt, data.method, data.source, data.providerTxid || null,
                data.idempotencyKey, data.createdBy
            ]);

            const payment = this.mapFinancialPayment(payRes.rows[0]);

            // 4. Se houver monthlyRecordId, recalcular status do registro
            if (monthlyRecordId) {
                // Obter mês do registro
                const recRes = await client.query(`
                    SELECT month FROM psychotherapy_monthly_records WHERE id = $1;
                `, [monthlyRecordId]);
                if (recRes.rows.length > 0) {
                    await syncMonthlyRecord(client, validTenantId, data.patientId, recRes.rows[0].month.trim());
                }
            }

            await client.query('COMMIT');
            return payment;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async voidPayment(tenantId: string, paymentId: string, voidedBy: string, reason: string): Promise<FinancialPayment> {
        const validTenantId = validateTenantId(tenantId);
        const client = await this.dbPool.connect();
        try {
            await client.query('BEGIN');

            // 1. Lock payment
            const payRes = await client.query(`
                SELECT * FROM financial_payments
                WHERE tenant_id = $1 AND id = $2 FOR UPDATE;
            `, [validTenantId, paymentId]);

            if (payRes.rows.length === 0) {
                throw new NotFoundError('Pagamento não encontrado');
            }

            const oldPay = payRes.rows[0];
            if (oldPay.status === 'voided') {
                throw new AppError('Pagamento já foi estornado', 400);
            }

            // 2. Lock monthly record if associated
            const monthlyRecordId = oldPay.monthly_record_id;
            if (monthlyRecordId) {
                await client.query(`
                    SELECT id FROM psychotherapy_monthly_records
                    WHERE id = $1 FOR UPDATE;
                `, [monthlyRecordId]);
            }

            // 3. Atualizar status para voided
            const updateRes = await client.query(`
                UPDATE financial_payments
                SET status = 'voided', voided_at = NOW(), voided_by = $1, void_reason = $2
                WHERE tenant_id = $3 AND id = $4
                RETURNING *;
            `, [voidedBy, reason, validTenantId, paymentId]);

            const payment = this.mapFinancialPayment(updateRes.rows[0]);

            // 4. Se houver monthlyRecordId, recalcular status do registro
            if (monthlyRecordId) {
                const recRes = await client.query(`
                    SELECT month FROM psychotherapy_monthly_records WHERE id = $1;
                `, [monthlyRecordId]);
                if (recRes.rows.length > 0) {
                    await syncMonthlyRecord(client, validTenantId, oldPay.patient_id, recRes.rows[0].month.trim());
                }
            }

            // 5. Registrar no log de auditoria
            // Achado em 2026-07-08: este INSERT usava target_type/target_id/created_by, colunas
            // que não existem em audit_logs (schema real, migration 043: aggregate_type/
            // aggregate_id/operator_id/justification, esta última NOT NULL). Método nunca tinha
            // sido exercitado em produção (zero chamadores) — por isso nunca deu erro até agora.
            await client.query(`
                INSERT INTO audit_logs (id, tenant_id, aggregate_type, aggregate_id, action, operator_id, justification, payload)
                VALUES (gen_random_uuid(), $1, 'financial_payment', $2, 'void_payment', $3, $4, $5);
            `, [
                validTenantId, paymentId, voidedBy, reason,
                JSON.stringify({ reason, oldStatus: oldPay.status, amountCents: oldPay.amount_cents })
            ]);

            await client.query('COMMIT');
            return payment;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async findPaymentByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<FinancialPayment | null> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT * FROM financial_payments
            WHERE tenant_id = $1 AND idempotency_key = $2;
        `, [validTenantId, idempotencyKey]);
        return result.rows[0] ? this.mapFinancialPayment(result.rows[0]) : null;
    }

    async findPaymentById(tenantId: string, id: string): Promise<FinancialPayment | null> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT * FROM financial_payments
            WHERE tenant_id = $1 AND id = $2;
        `, [validTenantId, id]);
        return result.rows[0] ? this.mapFinancialPayment(result.rows[0]) : null;
    }

    private mapFinancialPayment(row: any): FinancialPayment {
        return {
            id: row.id,
            tenantId: row.tenant_id,
            patientId: row.patient_id,
            monthlyRecordId: row.monthly_record_id,
            amountCents: row.amount_cents,
            netAmountCents: row.net_amount_cents,
            processingFeeCents: row.processing_fee_cents,
            currency: row.currency,
            paidAt: new Date(row.paid_at),
            method: row.method,
            source: row.source,
            status: row.status,
            providerTxid: row.provider_txid,
            idempotencyKey: row.idempotency_key,
            voidedAt: row.voided_at ? new Date(row.voided_at) : null,
            voidedBy: row.voided_by,
            voidReason: row.void_reason,
            createdBy: row.created_by,
            createdAt: new Date(row.created_at)
        };
    }

    async saveReceipt(data: SaveReceiptDTO): Promise<PsychotherapyReceipt> {
        const tenantId = validateTenantId(data.tenantId);

        // 1. If it's an update, check if it exists
        if (data.id) {
            const check = await this.dbPool.query(
                `SELECT * FROM psychotherapy_receipts WHERE id = $1 AND tenant_id = $2`,
                [data.id, tenantId]
            );
            if (check.rows.length > 0) {
                const result = await this.dbPool.query(`
                    UPDATE psychotherapy_receipts
                    SET amount_cents = $3,
                        issue_date = $4,
                        description = $5,
                        updated_at = NOW()
                    WHERE id = $1 AND tenant_id = $2
                    RETURNING *;
                `, [data.id, tenantId, data.amountCents, data.issueDate, data.description]);
                return mapReceipt(result.rows[0]);
            }
        }

        // 2. If it's a new insert, generate receipt_number inside a transaction using tenant_receipt_sequences
        const client = await this.dbPool.connect();
        try {
            await client.query('BEGIN');

            // Upsert and increment the last_value for this tenant
            const seqResult = await client.query(`
                INSERT INTO tenant_receipt_sequences (tenant_id, last_value)
                VALUES ($1, 1)
                ON CONFLICT (tenant_id)
                DO UPDATE SET last_value = tenant_receipt_sequences.last_value + 1
                RETURNING last_value;
            `, [tenantId]);

            const nextNumber = seqResult.rows[0].last_value;

            // Buscar snapshots do paciente e tenant
            const patRes = await client.query(`
                SELECT name, document FROM psychotherapy_patients
                WHERE id = $1 AND tenant_id = $2;
            `, [data.patientId, tenantId]);
            if (patRes.rows.length === 0) {
                throw new NotFoundError('Paciente não encontrado');
            }
            const patient = patRes.rows[0];

            const tenRes = await client.query(`
                SELECT name, full_name, document, professional_id, address FROM tenants
                WHERE id = $1;
            `, [tenantId]);
            if (tenRes.rows.length === 0) {
                throw new NotFoundError('Tenant não encontrado');
            }
            const tenant = tenRes.rows[0];

            // Insert the receipt with the sequence number and snapshots
            const result = await client.query(`
                INSERT INTO psychotherapy_receipts (
                    id, tenant_id, patient_id, receipt_number, amount_cents, issue_date, description,
                    is_legacy, status,
                    patient_name_snapshot, patient_document_snapshot,
                    tenant_name_snapshot, tenant_document_snapshot,
                    tenant_professional_id_snapshot, tenant_address_snapshot
                )
                VALUES (
                    COALESCE($1::uuid, gen_random_uuid()),
                    $2,
                    $3,
                    $4,
                    $5,
                    $6,
                    $7,
                    false,
                    'issued',
                    $8, $9, $10, $11, $12, $13
                )
                RETURNING *;
            `, [
                data.id || null,
                tenantId,
                data.patientId,
                nextNumber,
                data.amountCents,
                data.issueDate,
                data.description,
                patient.name,
                patient.document || null,
                tenant.full_name || tenant.name,
                tenant.document || null,
                tenant.professional_id || null,
                tenant.address || null
            ]);

            const receipt = result.rows[0];

            // DUAL-WRITE: Insere correspondente em financial_payments
            const paymentId = crypto.randomUUID();
            const monthStr = toMonthStr(new Date(data.issueDate));
            const mrRes = await client.query(`
                SELECT id FROM psychotherapy_monthly_records
                WHERE tenant_id = $1 AND patient_id = $2 AND month = $3;
            `, [tenantId, data.patientId, monthStr]);
            const monthlyRecordId = mrRes.rows[0]?.id || null;

            await client.query(`
                INSERT INTO financial_payments (
                    id, tenant_id, patient_id, monthly_record_id, amount_cents, currency,
                    paid_at, method, source, status, idempotency_key, created_by
                )
                VALUES ($1, $2, $3, $4, $5, 'BRL', $6, 'other', 'manual', 'confirmed', $7, $2);
            `, [
                paymentId,
                tenantId,
                data.patientId,
                monthlyRecordId,
                data.amountCents,
                data.issueDate,
                `receipt_${receipt.id}`
            ]);

            // Atualiza o payment_id no recibo recém criado
            await client.query(`
                UPDATE psychotherapy_receipts
                SET payment_id = $1
                WHERE id = $2;
            `, [paymentId, receipt.id]);

            await client.query('COMMIT');
            return mapReceipt(receipt);
        } catch (error: any) {
            await client.query('ROLLBACK');
            if (error.code === '23505' && typeof error.detail === 'string' && error.detail.includes('idx_receipts_tenant_number')) {
                throw new AppError('Conflito ao gerar número do recibo. Tente novamente.', 409);
            }
            throw error;
        } finally {
            client.release();
        }
    }

    async deleteReceipt(tenantId: string, id: string): Promise<void> {
        const validTenantId = validateTenantId(tenantId);
        const client = await this.dbPool.connect();
        try {
            await client.query('BEGIN');

            const receiptRes = await client.query(`
                SELECT payment_id FROM psychotherapy_receipts
                WHERE tenant_id = $1 AND id = $2;
            `, [validTenantId, id]);

            if (receiptRes.rowCount === 0) {
                throw new NotFoundError('Recibo não encontrado ou não autorizado');
            }

            const paymentId = receiptRes.rows[0].payment_id;

            await client.query(`
                DELETE FROM psychotherapy_receipts
                WHERE tenant_id = $1 AND id = $2;
            `, [validTenantId, id]);

            if (paymentId) {
                await client.query(`
                    DELETE FROM financial_payments
                    WHERE id = $1 AND tenant_id = $2;
                `, [paymentId, validTenantId]);
            }

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    async saveMonthlyRecord(data: SaveMonthlyRecordDTO): Promise<PsychotherapyMonthlyRecord> {
        const tenantId = validateTenantId(data.tenantId);
        if (data.id) {
            const updated = await this.dbPool.query(`
                UPDATE psychotherapy_monthly_records
                SET
                    patient_id = $3,
                    patient_name_snapshot = $4,
                    status = $5,
                    payment_type = $6,
                    session_price_cents = $7,
                    expected_sessions = COALESCE($8, 0),
                    paid_sessions = COALESCE($9, 0),
                    -- absences NÃO é atualizado aqui: é derivado de agendamentos marcados "Faltou"
                    -- (ver syncMonthlyRecord) e não deve ser sobrescrito por um valor desatualizado
                    -- que o cliente tinha em memória antes de uma falta ser marcada em outra tela.
                    payment_status = COALESCE($10, 'pending'),
                    notes = $11,
                    previous_month_paid_cents = COALESCE($12, 0),
                    updated_at = NOW()
                WHERE tenant_id = $1 AND id = $2
                RETURNING *;
            `, [
                tenantId,
                data.id,
                data.patientId || null,
                data.patientNameSnapshot,
                data.status,
                data.paymentType || null,
                data.sessionPriceCents ?? null,
                data.expectedSessions ?? 0,
                data.paidSessions ?? 0,
                data.paymentStatus || 'pending',
                data.notes || null,
                data.previousMonthPaidCents ?? 0
            ]);

            if (updated.rows.length === 0) throw new NotFoundError('Registro mensal não encontrado ou não autorizado');

            // expected_sessions é derivado da contagem real de agendamentos (ver
            // syncMonthlyRecord), não deve ser aceito do cliente — a tela sempre reenvia o
            // valor que tinha em memória junto de QUALQUER edição (pagar sessão, editar
            // preço, etc.), e se esse valor estiver desatualizado (ex: cache de antes de um
            // agendamento ser resolvido), a edição não-relacionada acaba revertendo o total
            // esperado pro valor antigo. Resincroniza aqui pra garantir que fique sempre
            // correto, não importa o que o cliente mandou. Vale pros dois payment_type desde
            // 2026-07-06 (antes só "per_session" — Achado real: Felipe, 2026-07-05); "monthly"
            // ficava com o piso antigo travado no cache do cliente até um agendamento mudar de
            // status. Achado real: Lucas (2026-07-06).
            if (data.patientId) {
                await syncMonthlyRecord(this.dbPool, tenantId, data.patientId, data.month);
                const resynced = await this.dbPool.query(
                    `SELECT * FROM psychotherapy_monthly_records WHERE id = $1;`,
                    [data.id]
                );
                if (resynced.rows.length > 0) return mapMonthlyRecord(resynced.rows[0]);
            }

            return mapMonthlyRecord(updated.rows[0]);
        }

        const result = await this.dbPool.query(`
            INSERT INTO psychotherapy_monthly_records (
                id, tenant_id, patient_id, month, patient_name_snapshot, status, payment_type,
                session_price_cents, expected_sessions, paid_sessions, absences,
                payment_status, notes, previous_month_paid_cents
            )
            VALUES (
                COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7,
                $8, COALESCE($9, 0), COALESCE($10, 0), COALESCE($11, 0),
                COALESCE($12, 'pending'), $13, COALESCE($14, 0)
            )
            ON CONFLICT (tenant_id, month, patient_id) WHERE patient_id IS NOT NULL DO UPDATE SET
                patient_name_snapshot = EXCLUDED.patient_name_snapshot,
                status = EXCLUDED.status,
                payment_type = EXCLUDED.payment_type,
                session_price_cents = EXCLUDED.session_price_cents,
                expected_sessions = EXCLUDED.expected_sessions,
                paid_sessions = EXCLUDED.paid_sessions,
                -- absences preservado (ver comentário equivalente no branch UPDATE acima)
                payment_status = EXCLUDED.payment_status,
                notes = EXCLUDED.notes,
                previous_month_paid_cents = EXCLUDED.previous_month_paid_cents,
                updated_at = NOW()
            RETURNING *;
        `, [
            data.id || null,
            tenantId,
            data.patientId || null,
            data.month,
            data.patientNameSnapshot,
            data.status,
            data.paymentType || null,
            data.sessionPriceCents ?? null,
            data.expectedSessions ?? 0,
            data.paidSessions ?? 0,
            data.absences ?? 0,
            data.paymentStatus || 'pending',
            data.notes || null,
            data.previousMonthPaidCents ?? 0
        ]);

        return mapMonthlyRecord(result.rows[0]);
    }

    async getPendingDetails(tenantId: string, currentMonthStr: string): Promise<PendingDetails> {
        const validTenantId = validateTenantId(tenantId);

        const [year, month] = currentMonthStr.split('-');
        const currentMonthStart = new Date(Date.UTC(parseInt(year, 10), parseInt(month, 10) - 1, 1));

        const cutoverRes = await this.dbPool.query(`
            SELECT cutover_at FROM tenant_financial_cutovers
            WHERE tenant_id = $1 AND status = 'approved';
        `, [validTenantId]);
        const cutoverAt = cutoverRes.rows[0]?.cutover_at ? new Date(cutoverRes.rows[0].cutover_at) : null;
        const isPostCutover = cutoverAt && (currentMonthStart.getTime() >= cutoverAt.getTime());

        const individualPatients: PendingPatientDetail[] = [];

        if (isPostCutover) {
            // Modo Ledger: pendência é amount-based (expected_amount_cents - pago), não há
            // contagem de sessão 1:1 tão direta quanto no fluxo legado — lista os pacientes
            // com pendência em meses já VENCIDOS (dia 11 do mês seguinte ao mês do registro —
            // nunca o mês corrente, cujo vencimento é sempre futuro) e as sessões (agendamentos
            // não cancelados) do mês, sem marcar "coberta" por sessão individual (o pagamento
            // no ledger não se amarra a uma sessão específica).
            const pendRes = await this.dbPool.query(`
                SELECT
                    mr.id, mr.patient_id, mr.patient_name_snapshot, mr.status, mr.payment_type, mr.month,
                    mr.session_price_cents, mr.expected_sessions, mr.absences, mr.paid_sessions,
                    mr.previous_month_paid_cents, mr.payment_status, mr.notes,
                    COALESCE(mr.expected_amount_cents, 0) AS expected_amount_cents,
                    COALESCE((
                        SELECT SUM(amount_cents) FROM financial_payments
                        WHERE monthly_record_id = mr.id AND status = 'confirmed'
                    ), 0) AS received_amount_cents
                FROM psychotherapy_monthly_records mr
                WHERE mr.tenant_id = $1 AND mr.patient_id IS NOT NULL
                  AND (to_date(mr.month, 'YYYY-MM') + INTERVAL '1 month' + INTERVAL '10 days')::date <= CURRENT_DATE
                ORDER BY mr.month ASC;
            `, [validTenantId]);

            for (const row of pendRes.rows) {
                const receivedAmountCents = parseInt(row.received_amount_cents, 10);
                const pendingAmountCents = Math.max(parseInt(row.expected_amount_cents, 10) - receivedAmountCents, 0);
                if (pendingAmountCents <= 0) continue;

                const apptRes = await this.dbPool.query(`
                    SELECT id, scheduled_at AS date, status FROM psychotherapy_appointments
                    WHERE patient_id = $1 AND tenant_id = $2
                      AND TO_CHAR(scheduled_at, 'YYYY-MM') = $3 AND status != 'canceled'
                      AND scheduled_at <= NOW()
                    ORDER BY scheduled_at ASC;
                `, [row.patient_id, validTenantId, row.month]);

                individualPatients.push({
                    recordId: row.id,
                    patientId: row.patient_id,
                    patientName: row.patient_name_snapshot,
                    status: row.status,
                    paymentType: row.payment_type,
                    month: row.month,
                    sessionPriceCents: row.session_price_cents,
                    expectedSessions: row.expected_sessions,
                    absences: row.absences,
                    paidSessions: row.paid_sessions,
                    previousMonthPaidCents: row.previous_month_paid_cents,
                    paymentStatus: row.payment_status,
                    notes: row.notes,
                    receivedAmountCents,
                    pendingAmountCents,
                    sessions: apptRes.rows.map((s: any) => ({
                        id: s.id, date: s.date, status: s.status, covered: false
                    }))
                });
            }
        } else {
            // Modo legado: busca as linhas cruas e reusa PsychotherapyMonthlyRecord (mesma
            // classe de domínio que Faturamento Mensal usa) pra calcular pendingAmountCents/
            // receivedAmountCents — em vez de reimplementar a fórmula em SQL, garante que os
            // dois telas nunca divirjam (são literalmente o mesmo cálculo). Só meses já
            // VENCIDOS entram aqui (ver regra do dia 11 no comentário de getDashboardAnalytics).
            const pendRes = await this.dbPool.query(`
                SELECT pmr.*
                FROM psychotherapy_monthly_records pmr
                WHERE pmr.tenant_id = $1 AND pmr.payment_status != 'paid'
                  AND pmr.patient_id IS NOT NULL
                  AND (to_date(pmr.month, 'YYYY-MM') + INTERVAL '1 month' + INTERVAL '10 days')::date <= CURRENT_DATE
                ORDER BY pmr.month ASC;
            `, [validTenantId]);

            for (const row of pendRes.rows) {
                const record = mapMonthlyRecord(row);
                const pendingAmountCents = record.pendingAmountCents;
                if (pendingAmountCents <= 0) continue;

                const sessions = await this.computeCoveredSessions(validTenantId, record.patientId!, record.month, record.paidSessions);

                individualPatients.push({
                    recordId: record.id,
                    patientId: record.patientId!,
                    patientName: record.patientNameSnapshot,
                    status: record.status,
                    paymentType: record.paymentType!,
                    month: record.month,
                    sessionPriceCents: record.sessionPriceCents,
                    expectedSessions: record.expectedSessions,
                    absences: record.absences,
                    paidSessions: record.paidSessions,
                    previousMonthPaidCents: record.previousMonthPaidCents,
                    paymentStatus: record.paymentStatus,
                    notes: record.notes,
                    receivedAmountCents: record.receivedAmountCents,
                    pendingAmountCents,
                    sessions
                });
            }
        }

        const groupRes = await this.dbPool.query(`
            SELECT gp.id, gp.amount_cents, gp.due_date, gp.reference_month, tg.name AS group_name, p.name AS patient_name
            FROM group_payments gp
            JOIN therapy_groups tg ON tg.id = gp.group_id
            LEFT JOIN psychotherapy_patients p ON p.id = gp.patient_id
            WHERE gp.tenant_id = $1 AND gp.status = 'pending'
              AND COALESCE(gp.due_date, CURRENT_DATE) <= CURRENT_DATE
            ORDER BY gp.reference_month ASC, tg.name, p.name;
        `, [validTenantId]);

        return {
            month: currentMonthStr,
            individualPatients: individualPatients.sort((a, b) =>
                a.month === b.month ? b.pendingAmountCents - a.pendingAmountCents : a.month.localeCompare(b.month)
            ),
            groupCharges: groupRes.rows.map((r: any) => ({
                groupPaymentId: r.id,
                groupName: r.group_name,
                memberName: r.patient_name,
                amountCents: r.amount_cents,
                dueDate: r.due_date
            }))
        };
    }

    // Faltas (no_show) nunca são "cobertas" nem "pendentes" (não entram na conta, já
    // descontadas via absences). Entre as demais (attended/scheduled/confirmed), as
    // primeiras `paidSessions` (em ordem cronológica) contam como já pagas — mesma
    // ordinalidade usada em receivedAmountCents, só que explicitada sessão a sessão.
    // Extraído de getPendingDetails() em 2026-07-08 pra ser reutilizado também na
    // coloração de "sessão paga" da tela de Agendamentos.
    private async computeCoveredSessions(
        tenantId: string, patientId: string, month: string, paidSessions: number
    ): Promise<PendingSessionDetail[]> {
        const apptRes = await this.dbPool.query(`
            SELECT id, scheduled_at AS date, status FROM psychotherapy_appointments
            WHERE patient_id = $1 AND tenant_id = $2
              AND TO_CHAR(scheduled_at, 'YYYY-MM') = $3 AND status != 'canceled'
              AND scheduled_at <= NOW()
            ORDER BY scheduled_at ASC;
        `, [patientId, tenantId, month]);

        let billableSeen = 0;
        return apptRes.rows.map((s: any) => {
            if (s.status === 'no_show') {
                return { id: s.id, date: s.date, status: s.status, covered: false };
            }
            billableSeen++;
            return { id: s.id, date: s.date, status: s.status, covered: billableSeen <= paidSessions };
        });
    }

    // Usado pela tela de Agendamentos pra sinalizar visualmente quais sessões já foram
    // pagas — não é usado por nenhum cálculo financeiro (só reflete o mesmo "covered" que
    // getPendingDetails já expõe pra sessões vencidas, mas pro mês inteiro, vencido ou não).
    async listCoveredAppointmentIds(tenantId: string, month: string): Promise<string[]> {
        const validTenantId = validateTenantId(tenantId);
        const recordsRes = await this.dbPool.query(`
            SELECT patient_id, paid_sessions FROM psychotherapy_monthly_records
            WHERE tenant_id = $1 AND month = $2 AND patient_id IS NOT NULL AND paid_sessions > 0;
        `, [validTenantId, month]);

        const covered: string[] = [];
        for (const row of recordsRes.rows) {
            const sessions = await this.computeCoveredSessions(validTenantId, row.patient_id, month, row.paid_sessions);
            for (const s of sessions) {
                if (s.covered) covered.push(s.id);
            }
        }
        return covered;
    }
}
