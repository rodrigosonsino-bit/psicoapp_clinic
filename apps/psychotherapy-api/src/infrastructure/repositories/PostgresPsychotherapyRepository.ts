import { Pool } from 'pg';
import {
    IPsychotherapyRepository,
    PsychotherapyMonthSummary,
    SaveMonthlyRecordDTO,
    SavePatientDTO,
    UpdateTenantProfileDTO,
    SaveReceiptDTO,
    PaginationOptions,
    PaginatedResult,
    SaveAppointmentDTO,
    ListAppointmentsOptions,
    UpcomingAppointment,
    GoogleOAuthTokens,
    SaveAvailabilitySlotDTO,
    FinancialPayment,
    RegisterPaymentDTO,
    MarkReminderSentOptions
} from '../../domain/repositories/IPsychotherapyRepository';
import { PsychotherapyPatient } from '../../domain/models/PsychotherapyPatient';
import { PsychotherapyMonthlyRecord } from '../../domain/models/PsychotherapyMonthlyRecord';
import { TenantProfile } from '../../domain/models/TenantProfile';
import { PsychotherapyReceipt } from '../../domain/models/PsychotherapyReceipt';
import { PsychotherapySession } from '../../domain/models/PsychotherapySession';
import { PsychotherapyExpense } from '../../domain/models/PsychotherapyExpense';
import { PsychotherapyFixedExpense } from '../../domain/models/PsychotherapyFixedExpense';
import { DashboardAnalytics, PendingDetails, SaveExpenseDTO, SaveSessionDTO, SaveClinicalNoteDTO, SaveFixedExpenseDTO, AddAdvanceCreditDTO } from '../../domain/repositories/IPsychotherapyRepository';
import { AppointmentStatus, PsychotherapyAppointment } from '../../domain/models/PsychotherapyAppointment';
import { ClinicalNote } from '../../domain/models/ClinicalNote';
import { AvailabilitySlot } from '../../domain/models/AvailabilitySlot';
import { BookingLink } from '../../domain/models/BookingLink';
import { validateTenantId, mapAppointment, mapExpense, mapMonthlyRecord, mapReceipt } from './shared';
import { PostgresPatientRepository } from './PostgresPatientRepository';
import { PostgresSessionRepository } from './PostgresSessionRepository';
import { PostgresAppointmentRepository } from './PostgresAppointmentRepository';
import { PostgresExpenseRepository } from './PostgresExpenseRepository';
import { PostgresTenantProfileRepository } from './PostgresTenantProfileRepository';
import { PostgresGoogleOAuthRepository } from './PostgresGoogleOAuthRepository';
import { PostgresAvailabilitySlotRepository } from './PostgresAvailabilitySlotRepository';
import { PostgresBookingLinkRepository } from './PostgresBookingLinkRepository';
import { PostgresBillingRepository } from './PostgresBillingRepository';

const SESSIONS_BY_PATIENT_STATUS: Record<string, number> = {
    weekly: 4, biweekly: 2, one_off: 0, inactive: 0,
};

import { injectable } from 'tsyringe';
import { AppError } from '../../domain/errors/AppError';
import { BusinessError } from '../../domain/errors/BusinessError';

@injectable()
export class PostgresPsychotherapyRepository implements IPsychotherapyRepository {
    private readonly tenantProfileRepository: PostgresTenantProfileRepository;
    private readonly googleOAuthRepository: PostgresGoogleOAuthRepository;
    private readonly availabilitySlotRepository: PostgresAvailabilitySlotRepository;
    private readonly bookingLinkRepository: PostgresBookingLinkRepository;
    private readonly patientRepository: PostgresPatientRepository;
    private readonly sessionRepository: PostgresSessionRepository;
    private readonly appointmentRepository: PostgresAppointmentRepository;
    private readonly expenseRepository: PostgresExpenseRepository;
    private readonly billingRepository: PostgresBillingRepository;

    constructor(private readonly dbPool: Pool) {
        this.tenantProfileRepository = new PostgresTenantProfileRepository(dbPool);
        this.googleOAuthRepository = new PostgresGoogleOAuthRepository(dbPool);
        this.availabilitySlotRepository = new PostgresAvailabilitySlotRepository(dbPool);
        this.bookingLinkRepository = new PostgresBookingLinkRepository(dbPool);
        this.patientRepository = new PostgresPatientRepository(dbPool);
        this.sessionRepository = new PostgresSessionRepository(dbPool);
        this.appointmentRepository = new PostgresAppointmentRepository(dbPool);
        this.expenseRepository = new PostgresExpenseRepository(dbPool);
        this.billingRepository = new PostgresBillingRepository(dbPool);
    }

    async savePatient(data: SavePatientDTO): Promise<PsychotherapyPatient> {
        return this.patientRepository.savePatient(data);
    }

    async listPatients(tenantId: string, pagination?: PaginationOptions): Promise<any> {
        return this.patientRepository.listPatients(tenantId, pagination);
    }

    async listIndividualPatientsForBilling(tenantId: string): Promise<PsychotherapyPatient[]> {
        return this.patientRepository.listIndividualPatientsForBilling(tenantId);
    }

    async findPatientById(tenantId: string, id: string): Promise<PsychotherapyPatient | null> {
        return this.patientRepository.findPatientById(tenantId, id);
    }

    async findActivePatientById(tenantId: string, id: string): Promise<PsychotherapyPatient | null> {
        return this.patientRepository.findActivePatientById(tenantId, id);
    }

    async findPatientByIdIncludingDeleted(tenantId: string, id: string): Promise<PsychotherapyPatient | null> {
        return this.patientRepository.findPatientByIdIncludingDeleted(tenantId, id);
    }

    async deletePatient(tenantId: string, id: string): Promise<void> {
        return this.patientRepository.deletePatient(tenantId, id);
    }

    async saveMonthlyRecord(data: SaveMonthlyRecordDTO): Promise<PsychotherapyMonthlyRecord> {
        return this.billingRepository.saveMonthlyRecord(data);
    }

    // Fix #4: single bulk INSERT instead of N sequential inserts.
    // Uses ON CONFLICT DO NOTHING to preserve existing data entered by the user.
    async bulkSaveMonthlyRecords(data: SaveMonthlyRecordDTO[]): Promise<PsychotherapyMonthlyRecord[]> {
        if (data.length === 0) return [];

        const tenantId = validateTenantId(data[0].tenantId);
        const COLS = 14;
        const values: unknown[] = [];

        const placeholders = data.map((record, i) => {
            const base = i * COLS;
            const p = (n: number) => `$${base + n}`;
            values.push(
                null,                                   // 1 id → gen_random_uuid()
                tenantId,                               // 2
                record.patientId || null,               // 3
                record.month,                           // 4
                record.patientNameSnapshot,             // 5
                record.status,                          // 6
                record.paymentType || null,             // 7
                record.sessionPriceCents ?? null,       // 8
                record.expectedSessions ?? 0,           // 9
                record.paidSessions ?? 0,               // 10
                record.absences ?? 0,                   // 11
                record.paymentStatus || 'pending',      // 12
                record.notes || null,                   // 13
                record.previousMonthPaidCents ?? 0      // 14
            );
            return `(
                COALESCE(${p(1)}::uuid, gen_random_uuid()),
                ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ${p(7)},
                ${p(8)},
                COALESCE(${p(9)}, 0), COALESCE(${p(10)}, 0), COALESCE(${p(11)}, 0),
                COALESCE(${p(12)}, 'pending'), ${p(13)}, COALESCE(${p(14)}, 0)
            )`;
        });

        const result = await this.dbPool.query(`
            INSERT INTO psychotherapy_monthly_records (
                id, tenant_id, patient_id, month, patient_name_snapshot, status, payment_type,
                session_price_cents, expected_sessions, paid_sessions, absences,
                payment_status, notes, previous_month_paid_cents
            )
            VALUES ${placeholders.join(', ')}
            ON CONFLICT (tenant_id, month, patient_id) WHERE patient_id IS NOT NULL
            DO UPDATE SET
                expected_sessions = GREATEST(
                    EXCLUDED.expected_sessions,
                    psychotherapy_monthly_records.expected_sessions
                ),
                payment_status = CASE
                    WHEN psychotherapy_monthly_records.paid_sessions >= GREATEST(
                        GREATEST(EXCLUDED.expected_sessions, psychotherapy_monthly_records.expected_sessions) - psychotherapy_monthly_records.absences, 0) THEN 'paid'
                    WHEN psychotherapy_monthly_records.paid_sessions > 0 THEN 'partial'
                    ELSE 'pending'
                END,
                updated_at = NOW()
            RETURNING *;
        `, values);

        return result.rows.map(row => mapMonthlyRecord(row));
    }

    async addAdvanceCredit(data: AddAdvanceCreditDTO): Promise<PsychotherapyMonthlyRecord> {
        const tenantId = validateTenantId(data.tenantId);
        if (data.amountCents <= 0) {
            throw new AppError('O valor adiantado deve ser maior que zero.', 400);
        }

        // ON CONFLICT soma (não substitui) previous_month_paid_cents — permite múltiplos
        // adiantamentos acumularem antes do mês ser gerado/consolidado. Os demais campos só
        // são usados na criação (INSERT); se o registro já existir, ficam como estão (a
        // geração normal do mês, via bulkSaveMonthlyRecords, também nunca sobrescreve esse
        // campo — só soma aqui).
        const result = await this.dbPool.query(`
            INSERT INTO psychotherapy_monthly_records (
                id, tenant_id, patient_id, month, patient_name_snapshot, status, payment_type,
                session_price_cents, expected_sessions, paid_sessions, absences,
                payment_status, notes, previous_month_paid_cents
            ) VALUES (
                gen_random_uuid(), $1, $2, $3, $4, $5, $6,
                $7, 0, 0, 0,
                'pending', NULL, $8
            )
            ON CONFLICT (tenant_id, month, patient_id) WHERE patient_id IS NOT NULL DO UPDATE SET
                previous_month_paid_cents = psychotherapy_monthly_records.previous_month_paid_cents + EXCLUDED.previous_month_paid_cents,
                updated_at = NOW()
            RETURNING *;
        `, [
            tenantId,
            data.patientId,
            data.targetMonth,
            data.patientNameSnapshot,
            data.status,
            data.paymentType,
            data.sessionPriceCents,
            data.amountCents
        ]);

        return mapMonthlyRecord(result.rows[0]);
    }

    /**
     * Conta agendamentos ativos (não cancelados) por paciente em um dado mês.
     * Usa query de agregação direta — evita carregar todos os registros em memória.
     * Retorna um Map<patientId, count>.
     */
    async countScheduledSessionsByPatient(tenantId: string, month: string): Promise<Map<string, number>> {
        const validTenantId = validateTenantId(tenantId);

        // Limites do mês em UTC, considerando o fuso America/Sao_Paulo (UTC-3)
        const monthStart = new Date(`${month}-01T03:00:00.000Z`);
        const monthEnd   = new Date(monthStart);
        monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);

        const result = await this.dbPool.query<{ patient_id: string; session_count: string }>(`
            SELECT patient_id, COUNT(*) AS session_count
            FROM psychotherapy_appointments
            WHERE tenant_id   = $1
              AND scheduled_at >= $2
              AND scheduled_at <  $3
              AND status NOT IN ('canceled')
            GROUP BY patient_id
        `, [validTenantId, monthStart, monthEnd]);

        const map = new Map<string, number>();
        for (const row of result.rows) {
            map.set(row.patient_id, parseInt(row.session_count, 10));
        }
        return map;
    }

    async listMonthlyRecords(tenantId: string, month: string): Promise<PsychotherapyMonthlyRecord[]> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT *
            FROM psychotherapy_monthly_records
            WHERE tenant_id = $1 AND month = $2
            ORDER BY status = 'inactive', patient_name_snapshot ASC;
        `, [validTenantId, month]);

        return result.rows.map(row => mapMonthlyRecord(row));
    }

    async getMonthSummary(tenantId: string, month: string): Promise<PsychotherapyMonthSummary> {
        const records = await this.listMonthlyRecords(tenantId, month);
        return this.computeSummaryFromRecords(month, records);
    }

    async getTenantProfile(tenantId: string): Promise<TenantProfile | null> {
        return this.tenantProfileRepository.getTenantProfile(tenantId);
    }

    async updateTenantProfile(data: UpdateTenantProfileDTO): Promise<TenantProfile> {
        return this.tenantProfileRepository.updateTenantProfile(data);
    }

    async saveReceipt(data: SaveReceiptDTO): Promise<PsychotherapyReceipt> {
        return this.billingRepository.saveReceipt(data);
    }

    async listReceipts(tenantId: string, patientId?: string): Promise<PsychotherapyReceipt[]> {
        const validTenantId = validateTenantId(tenantId);
        let query = 'SELECT * FROM psychotherapy_receipts WHERE tenant_id = $1';
        const params: any[] = [validTenantId];
        
        if (patientId) {
            query += ' AND patient_id = $2';
            params.push(patientId);
        }
        
        query += ' ORDER BY issue_date DESC, receipt_number DESC;';
        
        const result = await this.dbPool.query(query, params);
        return result.rows.map(row => mapReceipt(row));
    }

    async deleteReceipt(tenantId: string, id: string): Promise<void> {
        return this.billingRepository.deleteReceipt(tenantId, id);
    }

    async saveSession(data: SaveSessionDTO): Promise<PsychotherapySession> {
        return this.sessionRepository.saveSession(data);
    }

    async listSessions(
        tenantId: string,
        patientId?: string,
        start?: Date,
        end?: Date,
        pagination?: PaginationOptions
    ): Promise<PaginatedResult<PsychotherapySession>> {
        return this.sessionRepository.listSessions(tenantId, patientId, start, end, pagination);
    }

    async deleteSession(tenantId: string, id: string): Promise<void> {
        return this.sessionRepository.deleteSession(tenantId, id);
    }

    async saveExpense(data: SaveExpenseDTO): Promise<PsychotherapyExpense> {
        return this.expenseRepository.saveExpense(data);
    }

    async listExpenses(
        tenantId: string,
        start?: Date,
        end?: Date,
        pagination?: PaginationOptions
    ): Promise<PaginatedResult<PsychotherapyExpense>> {
        const validTenantId = validateTenantId(tenantId);

        // Auto-instantiate fixed expenses for current month and any months in start-end range.
        // Usa America/Sao_Paulo explicitamente (não new Date().getMonth(), que usa o fuso do
        // servidor — normalmente UTC no Railway — e podia calcular o "mês atual" errado perto
        // da virada do dia em BRT, achado na revisão de 04/07/2026).
        const currentMonth = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Sao_Paulo',
            year: 'numeric',
            month: '2-digit',
        }).format(new Date()).slice(0, 7);
        await this.checkAndInstantiateFixedExpenses(validTenantId, currentMonth);
        
        if (start && end) {
            let tempDate = new Date(start);
            tempDate.setUTCDate(1);
            while (tempDate <= end) {
                const mStr = `${tempDate.getUTCFullYear()}-${String(tempDate.getUTCMonth() + 1).padStart(2, '0')}`;
                await this.checkAndInstantiateFixedExpenses(validTenantId, mStr);
                tempDate.setUTCMonth(tempDate.getUTCMonth() + 1);
            }
        }

        let query = 'SELECT *, COUNT(*) OVER() AS total_count FROM psychotherapy_expenses WHERE tenant_id = $1';
        const params: any[] = [validTenantId];
        
        if (start) {
            params.push(start);
            query += ` AND date >= $${params.length}`;
        }
        
        if (end) {
            params.push(end);
            query += ` AND date <= $${params.length}`;
        }
        
        query += ' ORDER BY date DESC';
        
        if (pagination) {
            const offset = (pagination.page - 1) * pagination.limit;
            params.push(pagination.limit, offset);
            query += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
        }
        
        query += ';';
        
        const result = await this.dbPool.query(query, params);
        if (result.rows.length === 0) return { data: [], total: 0 };
        const total = parseInt(result.rows[0].total_count, 10);
        return {
            data: result.rows.map(row => mapExpense(row)),
            total
        };
    }

    async deleteExpense(tenantId: string, id: string): Promise<void> {
        return this.expenseRepository.deleteExpense(tenantId, id);
    }

    async listFixedExpenses(tenantId: string): Promise<PsychotherapyFixedExpense[]> {
        return this.expenseRepository.listFixedExpenses(tenantId);
    }

    async saveFixedExpense(data: SaveFixedExpenseDTO): Promise<PsychotherapyFixedExpense> {
        return this.expenseRepository.saveFixedExpense(data);
    }

    async deleteFixedExpense(tenantId: string, id: string): Promise<void> {
        return this.expenseRepository.deleteFixedExpense(tenantId, id);
    }

    async toggleFixedExpense(tenantId: string, id: string, active: boolean): Promise<PsychotherapyFixedExpense> {
        return this.expenseRepository.toggleFixedExpense(tenantId, id, active);
    }

    async expenseExistsForMonth(tenantId: string, fixedExpenseId: string, month: string): Promise<boolean> {
        return this.expenseRepository.expenseExistsForMonth(tenantId, fixedExpenseId, month);
    }

    private async checkAndInstantiateFixedExpenses(tenantId: string, monthStr: string): Promise<void> {
        const validTenantId = validateTenantId(tenantId);
        const fixedExpenses = await this.expenseRepository.listFixedExpenses(validTenantId);

        for (const fe of fixedExpenses) {
            if (!fe.active) continue;

            const startMonth = fe.startDate.substring(0, 7); // YYYY-MM
            if (monthStr < startMonth) continue;

            if (fe.endDate) {
                const endMonth = fe.endDate.substring(0, 7); // YYYY-MM
                if (monthStr > endMonth) continue;
            }

            const [yearStr, mStr] = monthStr.split('-');
            const year = parseInt(yearStr, 10);
            const monthIdx = parseInt(mStr, 10) - 1;
            const day = Math.min(fe.dayOfMonth, 28);
            const date = new Date(Date.UTC(year, monthIdx, day, 12, 0, 0));

            // INSERT atômico com ON CONFLICT DO NOTHING no índice único parcial
            // uq_psychotherapy_expenses_fixed_month (migration 081) — substitui o antigo
            // padrão SELECT (expenseExistsForMonth) + INSERT (saveExpense), que tinha race
            // condition real: duas requests concorrentes (2 abas, polling duplo do dashboard)
            // podiam ambas ver "não existe" e inserir, duplicando a despesa do mês.
            // saveExpense() não serve aqui porque sempre gera um id novo e faz
            // ON CONFLICT (id) DO UPDATE — nunca colide, então nunca detectava a duplicata.
            await this.dbPool.query(`
                INSERT INTO psychotherapy_expenses (
                    id, tenant_id, date, amount_cents, description, category,
                    fixed_expense_id, reference_month
                ) VALUES (
                    gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7
                )
                ON CONFLICT (tenant_id, fixed_expense_id, reference_month)
                    WHERE fixed_expense_id IS NOT NULL
                    DO NOTHING
            `, [validTenantId, date, fe.amountCents, fe.description, fe.category || 'other', fe.id, monthStr]);
        }
    }

    async getDashboardAnalytics(tenantId: string, currentMonthStr: string): Promise<DashboardAnalytics> {
        const validTenantId = validateTenantId(tenantId);

        const [year, month] = currentMonthStr.split('-');
        const currentYearNum = parseInt(year, 10);
        const currentMonthNum = parseInt(month, 10);

        // Date range calculation (UTC to avoid timezone offsets)
        const startDate = new Date(Date.UTC(currentYearNum, currentMonthNum - 6, 1));
        const endDate = new Date(Date.UTC(currentYearNum, currentMonthNum, 1));

        // Auto-instantiate fixed expenses for the 6 months trend
        let tempDate = new Date(startDate);
        while (tempDate < endDate) {
            const mStr = `${tempDate.getUTCFullYear()}-${String(tempDate.getUTCMonth() + 1).padStart(2, '0')}`;
            await this.checkAndInstantiateFixedExpenses(validTenantId, mStr);
            tempDate.setUTCMonth(tempDate.getUTCMonth() + 1);
        }

        // 1. Obter configuração de cutover
        const cutoverRes = await this.dbPool.query(`
            SELECT cutover_at FROM tenant_financial_cutovers
            WHERE tenant_id = $1 AND status = 'approved';
        `, [validTenantId]);
        const cutoverAt = cutoverRes.rows[0]?.cutover_at ? new Date(cutoverRes.rows[0].cutover_at) : null;

        // Construir a lista de 6 meses cronológicos
        const monthsList: string[] = [];
        let d = new Date(Date.UTC(currentYearNum, currentMonthNum - 6, 1));
        for (let i = 0; i < 6; i++) {
            const yyyy = d.getUTCFullYear();
            const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
            monthsList.push(`${yyyy}-${mm}`);
            d.setUTCMonth(d.getUTCMonth() + 1);
        }

        const sixMonthsTrend: { month: string; revenueCents: number; expensesCents: number }[] = [];
        let currentMonthRevenue = 0;
        let currentMonthSessionRevenue = 0;
        let currentMonthExpenses = 0;

        for (const m of monthsList) {
            const [mYear, mMonth] = m.split('-');
            const mYearNum = parseInt(mYear, 10);
            const mMonthNum = parseInt(mMonth, 10);
            const mStart = new Date(Date.UTC(mYearNum, mMonthNum - 1, 1));
            const mEnd = new Date(Date.UTC(mYearNum, mMonthNum, 1));

            // Calcular Despesas do mês
            const expRes = await this.dbPool.query(`
                SELECT COALESCE(SUM(amount_cents), 0) AS total
                FROM psychotherapy_expenses
                WHERE tenant_id = $1 AND date >= $2 AND date < $3;
            `, [validTenantId, mStart, mEnd]);
            const expenses = parseInt(expRes.rows[0].total, 10);

            let revenue = 0;
            let sessionRevenue = 0;

            const isPostCutover = cutoverAt && (mStart.getTime() >= cutoverAt.getTime());

            if (isPostCutover) {
                // Modo Ledger: Soma pagamentos confirmados do ledger no período
                const revRes = await this.dbPool.query(`
                    SELECT COALESCE(SUM(amount_cents), 0) AS total
                    FROM financial_payments
                    WHERE tenant_id = $1 AND status = 'confirmed' AND paid_at >= $2 AND paid_at < $3;
                `, [validTenantId, mStart, mEnd]);
                revenue = parseInt(revRes.rows[0].total, 10);

                // session_revenue exclui group payments
                const sessRes = await this.dbPool.query(`
                    SELECT COALESCE(SUM(amount_cents), 0) AS total
                    FROM financial_payments
                    WHERE tenant_id = $1 AND status = 'confirmed' AND paid_at >= $2 AND paid_at < $3
                      AND monthly_record_id IS NOT NULL;
                `, [validTenantId, mStart, mEnd]);
                sessionRevenue = parseInt(sessRes.rows[0].total, 10);
            } else {
                // Modo Legado
                // Primeiro tenta snapshots legados aprovados
                const snapRes = await this.dbPool.query(`
                    SELECT COALESCE(SUM(amount_cents), 0) AS total
                    FROM legacy_financial_snapshots
                    WHERE tenant_id = $1 AND month = $2 AND status = 'approved';
                `, [validTenantId, m]);
                const snapTotal = parseInt(snapRes.rows[0].total, 10);

                if (snapTotal > 0) {
                    revenue = snapTotal;
                    sessionRevenue = snapTotal;
                } else {
                    // Fallback para fórmula antiga do domínio
                    const legacyRes = await this.dbPool.query(`
                        SELECT COALESCE(SUM(
                            COALESCE(session_price_cents, 0) * paid_sessions + previous_month_paid_cents
                        ), 0) as total
                        FROM psychotherapy_monthly_records
                        WHERE tenant_id = $1 AND month = $2;
                    `, [validTenantId, m]);

                    const groupRes = await this.dbPool.query(`
                        SELECT COALESCE(SUM(amount_cents), 0) AS total
                        FROM group_payments
                        WHERE tenant_id = $1 AND reference_month = $2;
                    `, [validTenantId, m]);

                    sessionRevenue = parseInt(legacyRes.rows[0].total, 10);
                    revenue = sessionRevenue + parseInt(groupRes.rows[0].total, 10);
                }
            }

            sixMonthsTrend.push({
                month: m,
                revenueCents: revenue,
                expensesCents: expenses
            });

            if (m === currentMonthStr) {
                currentMonthRevenue = revenue;
                currentMonthSessionRevenue = sessionRevenue;
                currentMonthExpenses = expenses;
            }
        }

        // Calcular pendências do mês corrente
        let pendingCents = 0;
        const currentMonthStart = new Date(Date.UTC(currentYearNum, currentMonthNum - 1, 1));
        const isCurrentPostCutover = cutoverAt && (currentMonthStart.getTime() >= cutoverAt.getTime());

        // Um mês só entra como "Inadimplência" depois de vencido — pagamento do mês M vence
        // dia 10 do mês seguinte, então M só conta a partir do dia 11 (nunca antes). Isso
        // exclui automaticamente o mês corrente (seu vencimento é sempre no futuro) sem
        // precisar de nenhum caso especial pra ele. Achado real: Matheus Penteado, parcial em
        // junho — não devia contar ainda em 2026-07-06 (antes do dia 11/07), só a partir de
        // 2026-07-11.

        if (isCurrentPostCutover) {
            // Pendente no ledger: expected_amount_cents - sum(payments confirmados), só pra
            // meses já vencidos (dia 11 do mês seguinte ao mês do registro).
            const pendRes = await this.dbPool.query(`
                SELECT COALESCE(SUM(
                    GREATEST(COALESCE(expected_amount_cents, 0) - COALESCE((
                        SELECT SUM(amount_cents) FROM financial_payments
                        WHERE monthly_record_id = mr.id AND status = 'confirmed'
                    ), 0), 0)
                ), 0) AS pending
                FROM psychotherapy_monthly_records mr
                WHERE mr.tenant_id = $1
                  AND (to_date(mr.month, 'YYYY-MM') + INTERVAL '1 month' + INTERVAL '10 days')::date <= CURRENT_DATE;
            `, [validTenantId]);

            // Cobranças de grupo: já usa due_date próprio (mais preciso que a regra genérica
            // acima), sem precisar de ajuste.
            const pendGroupRes = await this.dbPool.query(`
                SELECT COALESCE(SUM(amount_cents), 0) AS pending
                FROM group_payments
                WHERE tenant_id = $1 AND status = 'pending'
                  AND COALESCE(due_date, CURRENT_DATE) <= CURRENT_DATE;
            `, [validTenantId]);

            pendingCents = parseInt(pendRes.rows[0].pending, 10) + parseInt(pendGroupRes.rows[0].pending, 10);
        } else {
            // Pendente legado (individual): soma TODOS os meses VENCIDOS (ver
            // monthOverdueClause acima) com payment_status != 'paid' — antes só olhava o mês
            // corrente, então dívida de meses já fechados e vencidos ficava invisível na
            // métrica. Meses vencidos usam expected_sessions inteiro (o mês inteiro já
            // decorreu e já passou até do prazo de pagamento — sem sentido prorratear por
            // sessão "decorrida"). O mês corrente nunca aparece aqui (seu vencimento é sempre
            // no futuro), então não há mais rateio por sessão a fazer nesta métrica.
            const pendingResult = await this.dbPool.query(`
                SELECT COALESCE(SUM(
                    CASE
                        WHEN pmr.payment_type = 'monthly' THEN
                            GREATEST(
                                (pmr.expected_sessions - pmr.absences - pmr.paid_sessions)
                                    * pmr.session_price_cents::numeric / GREATEST(pmr.expected_sessions - pmr.absences, 1)
                                    - pmr.previous_month_paid_cents,
                            0)
                        ELSE
                            GREATEST(
                                GREATEST(pmr.expected_sessions - pmr.absences - pmr.paid_sessions, 0)
                                    * COALESCE(pmr.session_price_cents, 0)
                                    - pmr.previous_month_paid_cents,
                            0)
                    END
                ), 0) as pending
                FROM psychotherapy_monthly_records pmr
                WHERE pmr.tenant_id = $1 AND pmr.payment_status != 'paid'
                  AND (to_date(pmr.month, 'YYYY-MM') + INTERVAL '1 month' + INTERVAL '10 days')::date <= CURRENT_DATE
            `, [validTenantId]);

            const pendGroupRes = await this.dbPool.query(`
                SELECT COALESCE(SUM(amount_cents), 0) AS pending
                FROM group_payments
                WHERE tenant_id = $1 AND status = 'pending'
                  AND COALESCE(due_date, CURRENT_DATE) <= CURRENT_DATE;
            `, [validTenantId]);

            pendingCents = parseInt(pendingResult.rows[0].pending, 10) + parseInt(pendGroupRes.rows[0].pending, 10);
        }

        return {
            currentMonth: {
                revenueCents: currentMonthRevenue,
                sessionRevenueCents: currentMonthSessionRevenue,
                expensesCents: currentMonthExpenses,
                netIncomeCents: currentMonthRevenue - currentMonthExpenses,
                pendingCents
            },
            sixMonthsTrend
        };
    }

    /**
     * Detalhamento por paciente/cobrança do valor de "Inadimplência" do Dashboard —
     * mesmos números que getDashboardAnalytics, mas explodidos por linha em vez de somados.
     * Reusa exatamente a mesma fórmula de pendência (ver comentário em getDashboardAnalytics)
     * pra nunca divergir do total exibido no card.
     */
    async getPendingDetails(tenantId: string, currentMonthStr: string): Promise<PendingDetails> {
        return this.billingRepository.getPendingDetails(tenantId, currentMonthStr);
    }

    async listCoveredAppointmentIds(tenantId: string, month: string): Promise<string[]> {
        return this.billingRepository.listCoveredAppointmentIds(tenantId, month);
    }

    // ── Appointments ──────────────────────────────────────────────────────────

    async saveAppointment(data: SaveAppointmentDTO): Promise<PsychotherapyAppointment> {
        return this.appointmentRepository.saveAppointment(data);
    }

    async listAppointments(tenantId: string, options: ListAppointmentsOptions = {}): Promise<PaginatedResult<PsychotherapyAppointment>> {
        return this.appointmentRepository.listAppointments(tenantId, options);
    }

    async findAppointmentById(tenantId: string, id: string): Promise<PsychotherapyAppointment | null> {
        return this.appointmentRepository.findAppointmentById(tenantId, id);
    }

    async deleteAppointment(tenantId: string, id: string): Promise<void> {
        return this.appointmentRepository.deleteAppointment(tenantId, id);
    }

    async updateAppointmentStatus(tenantId: string, id: string, status: AppointmentStatus): Promise<PsychotherapyAppointment> {
        return this.appointmentRepository.updateAppointmentStatus(tenantId, id, status);
    }

    async findUpcomingAppointments(windowStart: Date, windowEnd: Date): Promise<UpcomingAppointment[]> {
        return this.appointmentRepository.findUpcomingAppointments(windowStart, windowEnd);
    }

    async findFailedWhatsappReminders(now: Date, windowStart: Date, maxAttempts: number): Promise<UpcomingAppointment[]> {
        return this.appointmentRepository.findFailedWhatsappReminders(now, windowStart, maxAttempts);
    }

    async markReminderSent(
        appointmentId: string,
        tenantId: string,
        channelUsed: 'whatsapp' | 'email',
        status: 'success' | 'failed',
        errorMessage?: string,
        options?: MarkReminderSentOptions
    ): Promise<void> {
        return this.appointmentRepository.markReminderSent(appointmentId, tenantId, channelUsed, status, errorMessage, options);
    }

    async hasReminderBeenSent(appointmentId: string, channelUsed: 'whatsapp' | 'email'): Promise<boolean> {
        return this.appointmentRepository.hasReminderBeenSent(appointmentId, channelUsed);
    }

    // ── Google OAuth Tokens ───────────────────────────────────────────────────

    async saveGoogleOAuthTokens(tenantId: string, accessToken: string, refreshToken: string, expiryDate: number, calendarId?: string): Promise<void> {
        return this.googleOAuthRepository.saveGoogleOAuthTokens(tenantId, accessToken, refreshToken, expiryDate, calendarId);
    }

    async getGoogleOAuthTokens(tenantId: string): Promise<GoogleOAuthTokens | null> {
        return this.googleOAuthRepository.getGoogleOAuthTokens(tenantId);
    }

    async updateGoogleAccessToken(tenantId: string, accessToken: string, expiryDate: number): Promise<void> {
        return this.googleOAuthRepository.updateGoogleAccessToken(tenantId, accessToken, expiryDate);
    }

    async listAllGoogleOAuthTokens(): Promise<GoogleOAuthTokens[]> {
        return this.googleOAuthRepository.listAllGoogleOAuthTokens();
    }

    async findAppointmentByGoogleEventId(tenantId: string, googleEventId: string): Promise<PsychotherapyAppointment | null> {
        return this.appointmentRepository.findAppointmentByGoogleEventId(tenantId, googleEventId);
    }

    async updateAppointmentGoogleEvent(id: string, tenantId: string, googleEventId: string, googleEventUrl: string): Promise<void> {
        return this.appointmentRepository.updateAppointmentGoogleEvent(id, tenantId, googleEventId, googleEventUrl);
    }

    async findAppointmentByConfirmToken(token: string): Promise<PsychotherapyAppointment | null> {
        return this.appointmentRepository.findAppointmentByConfirmToken(token);
    }

    async confirmAppointmentByToken(token: string): Promise<PsychotherapyAppointment | null> {
        return this.appointmentRepository.confirmAppointmentByToken(token);
    }

    // ── Clinical Notes ────────────────────────────────────────────────────────

    async saveClinicalNote(data: SaveClinicalNoteDTO): Promise<ClinicalNote> {
        return this.sessionRepository.saveClinicalNote(data);
    }

    async listClinicalNotes(tenantId: string, patientId: string, page = 1, limit = 20): Promise<PaginatedResult<ClinicalNote>> {
        return this.sessionRepository.listClinicalNotes(tenantId, patientId, page, limit);
    }

    async findClinicalNoteById(tenantId: string, id: string): Promise<ClinicalNote | null> {
        return this.sessionRepository.findClinicalNoteById(tenantId, id);
    }

    async deleteClinicalNote(tenantId: string, id: string): Promise<void> {
        return this.sessionRepository.deleteClinicalNote(tenantId, id);
    }

    // ── Availability Slots ────────────────────────────────────────────────────

    async saveAvailabilitySlot(data: SaveAvailabilitySlotDTO): Promise<AvailabilitySlot> {
        return this.availabilitySlotRepository.saveAvailabilitySlot(data);
    }

    async listAvailabilitySlots(tenantId: string): Promise<AvailabilitySlot[]> {
        return this.availabilitySlotRepository.listAvailabilitySlots(tenantId);
    }

    async deleteAvailabilitySlot(tenantId: string, id: string): Promise<void> {
        return this.availabilitySlotRepository.deleteAvailabilitySlot(tenantId, id);
    }

    async listActiveAppointmentDatetimes(tenantId: string, from: Date, to: Date): Promise<Date[]> {
        return this.appointmentRepository.listActiveAppointmentDatetimes(tenantId, from, to);
    }

    // ── Booking Links ──────────────────────────────────────────────────────────

    async upsertBookingLink(tenantId: string, patientId: string, expiresAt?: Date | null): Promise<BookingLink> {
        return this.bookingLinkRepository.upsertBookingLink(tenantId, patientId, expiresAt);
    }

    async findBookingLinkByToken(token: string): Promise<BookingLink | null> {
        return this.bookingLinkRepository.findBookingLinkByToken(token);
    }

    async deactivateBookingLink(tenantId: string, patientId: string): Promise<void> {
        return this.bookingLinkRepository.deactivateBookingLink(tenantId, patientId);
    }

    // ── Public booking tokens ─────────────────────────────────────────────────

    async getOrCreatePublicBookingToken(tenantId: string): Promise<string> {
        return this.bookingLinkRepository.getOrCreatePublicBookingToken(tenantId);
    }

    async findPublicBookingToken(token: string): Promise<string | null> {
        return this.bookingLinkRepository.findPublicBookingToken(token);
    }

    async findPatientByPhone(tenantId: string, phone: string): Promise<PsychotherapyPatient | null> {
        return this.patientRepository.findPatientByPhone(tenantId, phone);
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private computeSummaryFromRecords(month: string, records: PsychotherapyMonthlyRecord[]): PsychotherapyMonthSummary {
        return records.reduce<PsychotherapyMonthSummary>((acc, record) => {
            acc.totalPatients += 1;
            if (record.status === 'inactive') acc.inactivePatients += 1;
            else acc.activePatients += 1;

            if (record.paymentStatus === 'paid') acc.paidRecords += 1;
            if (record.paymentStatus === 'pending') acc.pendingRecords += 1;
            if (record.paymentStatus === 'partial') acc.partialRecords += 1;

            acc.expectedAmountCents += record.expectedAmountCents;
            acc.receivedAmountCents += record.receivedAmountCents;
            acc.pendingAmountCents += record.pendingAmountCents;
            acc.totalAbsences += record.absences;
            return acc;
        }, {
            month,
            totalPatients: 0,
            activePatients: 0,
            inactivePatients: 0,
            paidRecords: 0,
            pendingRecords: 0,
            partialRecords: 0,
            expectedAmountCents: 0,
            receivedAmountCents: 0,
            pendingAmountCents: 0,
            totalAbsences: 0
        });
    }

    async listSeriesAppointments(tenantId: string, rootId: string): Promise<PsychotherapyAppointment[]> {
        return this.appointmentRepository.listSeriesAppointments(tenantId, rootId);
    }

    async registerPayment(data: RegisterPaymentDTO): Promise<FinancialPayment> {
        return this.billingRepository.registerPayment(data);
    }

    async voidPayment(tenantId: string, paymentId: string, voidedBy: string, reason: string): Promise<FinancialPayment> {
        return this.billingRepository.voidPayment(tenantId, paymentId, voidedBy, reason);
    }

    async findPaymentByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<FinancialPayment | null> {
        return this.billingRepository.findPaymentByIdempotencyKey(tenantId, idempotencyKey);
    }

    async findPaymentById(tenantId: string, id: string): Promise<FinancialPayment | null> {
        return this.billingRepository.findPaymentById(tenantId, id);
    }
}
