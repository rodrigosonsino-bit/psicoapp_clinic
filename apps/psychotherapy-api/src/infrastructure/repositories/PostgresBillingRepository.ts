import { Pool } from 'pg';
import { PendingDetails, PendingPatientDetail, PendingSessionDetail } from '../../domain/repositories/IPsychotherapyRepository';
import { validateTenantId, mapMonthlyRecord } from './shared';

/**
 * Extraído de PostgresPsychotherapyRepository, preservando exatamente a lógica original.
 * `getPendingDetails` e `listCoveredAppointmentIds` são COMPLEXO-LEITURA (sem risco de escrita,
 * mas cruzam billing + appointments via `computeCoveredSessions`) — não são "folha" de um
 * domínio só. Ver .claude/plans/pendencias-tecnicas-pos-quitacao-2026-07.md (item 1) e
 * .claude/plans/classificacao-postgres-psychotherapy-repository.md.
 */
export class PostgresBillingRepository {
    constructor(private readonly dbPool: Pool) {}

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
