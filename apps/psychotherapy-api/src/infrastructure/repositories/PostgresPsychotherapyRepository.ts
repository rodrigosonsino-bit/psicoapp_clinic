import { Pool, PoolClient } from 'pg';
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
    SaveAvailabilitySlotDTO
} from '../../domain/repositories/IPsychotherapyRepository';
import { PsychotherapyPatient } from '../../domain/models/PsychotherapyPatient';
import { PsychotherapyMonthlyRecord } from '../../domain/models/PsychotherapyMonthlyRecord';
import { TenantProfile } from '../../domain/models/TenantProfile';
import { PsychotherapyReceipt } from '../../domain/models/PsychotherapyReceipt';
import { PASTORAL_SENTINEL_EMAIL } from '../../domain/constants/pastoral';
import { PsychotherapySession } from '../../domain/models/PsychotherapySession';
import { PsychotherapyExpense } from '../../domain/models/PsychotherapyExpense';
import { PsychotherapyFixedExpense } from '../../domain/models/PsychotherapyFixedExpense';
import { DashboardAnalytics, SaveExpenseDTO, SaveSessionDTO, SaveClinicalNoteDTO, SaveFixedExpenseDTO } from '../../domain/repositories/IPsychotherapyRepository';
import { AppointmentStatus, PsychotherapyAppointment } from '../../domain/models/PsychotherapyAppointment';
import { ClinicalNote } from '../../domain/models/ClinicalNote';
import { AvailabilitySlot, AvailabilityRecurrenceType, AvailabilityModality } from '../../domain/models/AvailabilitySlot';
import { BookingLink } from '../../domain/models/BookingLink';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Converte uma Date para o formato YYYY-MM no fuso America/Sao_Paulo */
function toMonthStr(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
    }).formatToParts(date);
    const y = parts.find(p => p.type === 'year')!.value;
    const m = parts.find(p => p.type === 'month')!.value;
    return `${y}-${m}`;
}

const SESSIONS_BY_PATIENT_STATUS: Record<string, number> = {
    weekly: 4, biweekly: 2, one_off: 0, inactive: 0,
};

import { injectable } from 'tsyringe';
import { AppError } from '../../domain/errors/AppError';
import { NotFoundError } from '../../domain/errors/NotFoundError';
import { BusinessError } from '../../domain/errors/BusinessError';
import {
    PatientRow,
    MonthlyRecordRow,
    TenantProfileRow,
    ReceiptRow,
    SessionRow,
    ExpenseRow,
    FixedExpenseRow,
    AppointmentRow,
    ClinicalNoteRow,
    AvailabilitySlotRow,
    BookingLinkRow
} from './dbRowTypes';

@injectable()
export class PostgresPsychotherapyRepository implements IPsychotherapyRepository {
    constructor(private readonly dbPool: Pool) {}

    async savePatient(data: SavePatientDTO): Promise<PsychotherapyPatient> {
        const tenantId = this.validateTenantId(data.tenantId);
        const result = await this.dbPool.query(`
            INSERT INTO psychotherapy_patients (
                id, tenant_id, name, status, payment_type, default_session_price_cents,
                notes, document, phone, email, reminder_channel, full_name
            )
            VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                status = EXCLUDED.status,
                payment_type = EXCLUDED.payment_type,
                default_session_price_cents = EXCLUDED.default_session_price_cents,
                notes = EXCLUDED.notes,
                document = EXCLUDED.document,
                phone = EXCLUDED.phone,
                email = EXCLUDED.email,
                reminder_channel = EXCLUDED.reminder_channel,
                full_name = EXCLUDED.full_name,
                updated_at = NOW()
            WHERE psychotherapy_patients.tenant_id = EXCLUDED.tenant_id
            RETURNING *;
        `, [
            data.id || null,
            tenantId,
            data.name,
            data.status,
            data.paymentType || null,
            data.defaultSessionPriceCents ?? null,
            data.notes || null,
            data.document || null,
            data.phone || null,
            data.email || null,
            data.reminderChannel ?? 'whatsapp',
            data.fullName ?? null
        ]);

        if (result.rows.length === 0) throw new NotFoundError('Paciente não encontrado ou não autorizado');

        if (data.id) {
            await this.dbPool.query(
                `UPDATE psychotherapy_monthly_records
                 SET patient_name_snapshot = $1
                 WHERE patient_id = $2 AND tenant_id = $3`,
                [data.name, data.id, tenantId]
            );
        }

        return this.mapPatient(result.rows[0]);
    }

    async listPatients(tenantId: string, pagination?: PaginationOptions): Promise<any> {
        const validTenantId = this.validateTenantId(tenantId);
        if (pagination) {
            const offset = (pagination.page - 1) * pagination.limit;
            const params: unknown[] = [validTenantId, PASTORAL_SENTINEL_EMAIL];
            let whereClause = 'WHERE tenant_id = $1 AND (email IS NULL OR email != $2)';

            if (pagination.search) {
                params.push(`%${pagination.search}%`);
                whereClause += ` AND name ILIKE $${params.length}`;
            }

            params.push(pagination.limit, offset);
            const result = await this.dbPool.query(`
                SELECT *, COUNT(*) OVER() AS total_count
                FROM psychotherapy_patients
                ${whereClause}
                ORDER BY status = 'inactive', name ASC
                LIMIT $${params.length - 1} OFFSET $${params.length};
            `, params);

            if (result.rows.length === 0) return { data: [], total: 0 };
            const total = parseInt(result.rows[0].total_count, 10);
            return {
                data: result.rows.map(row => this.mapPatient(row)),
                total
            };
        }

        const result = await this.dbPool.query(`
            SELECT *
            FROM psychotherapy_patients
            WHERE tenant_id = $1
            ORDER BY status = 'inactive', name ASC;
        `, [validTenantId]);

        return result.rows.map(row => this.mapPatient(row));
    }

    async findPatientById(tenantId: string, id: string): Promise<PsychotherapyPatient | null> {
        const validTenantId = this.validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT *
            FROM psychotherapy_patients
            WHERE tenant_id = $1 AND id = $2;
        `, [validTenantId, id]);

        return result.rows[0] ? this.mapPatient(result.rows[0]) : null;
    }

    async deletePatient(tenantId: string, id: string): Promise<void> {
        const validTenantId = this.validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            DELETE FROM psychotherapy_patients
            WHERE tenant_id = $1 AND id = $2;
        `, [validTenantId, id]);

        if (result.rowCount === 0) throw new NotFoundError('Paciente não encontrado ou não autorizado');
    }

    async saveMonthlyRecord(data: SaveMonthlyRecordDTO): Promise<PsychotherapyMonthlyRecord> {
        const tenantId = this.validateTenantId(data.tenantId);
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
                    absences = COALESCE($10, 0),
                    payment_status = COALESCE($11, 'pending'),
                    notes = $12,
                    previous_month_paid_cents = COALESCE($13, 0),
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
                data.absences ?? 0,
                data.paymentStatus || 'pending',
                data.notes || null,
                data.previousMonthPaidCents ?? 0
            ]);

            if (updated.rows.length === 0) throw new NotFoundError('Registro mensal não encontrado ou não autorizado');
            return this.mapMonthlyRecord(updated.rows[0]);
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
                absences = EXCLUDED.absences,
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

        return this.mapMonthlyRecord(result.rows[0]);
    }

    // Fix #4: single bulk INSERT instead of N sequential inserts.
    // Uses ON CONFLICT DO NOTHING to preserve existing data entered by the user.
    async bulkSaveMonthlyRecords(data: SaveMonthlyRecordDTO[]): Promise<PsychotherapyMonthlyRecord[]> {
        if (data.length === 0) return [];

        const tenantId = this.validateTenantId(data[0].tenantId);
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

        return result.rows.map(row => this.mapMonthlyRecord(row));
    }

    /**
     * Conta agendamentos ativos (não cancelados) por paciente em um dado mês.
     * Usa query de agregação direta — evita carregar todos os registros em memória.
     * Retorna um Map<patientId, count>.
     */
    async countScheduledSessionsByPatient(tenantId: string, month: string): Promise<Map<string, number>> {
        const validTenantId = this.validateTenantId(tenantId);

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
        const validTenantId = this.validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT *
            FROM psychotherapy_monthly_records
            WHERE tenant_id = $1 AND month = $2
            ORDER BY status = 'inactive', patient_name_snapshot ASC;
        `, [validTenantId, month]);

        return result.rows.map(row => this.mapMonthlyRecord(row));
    }

    async getMonthSummary(tenantId: string, month: string): Promise<PsychotherapyMonthSummary> {
        const records = await this.listMonthlyRecords(tenantId, month);
        return this.computeSummaryFromRecords(month, records);
    }

    async getTenantProfile(tenantId: string): Promise<TenantProfile | null> {
        const validTenantId = this.validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT id, name, email, full_name, document, professional_id, address, totp_enabled
            FROM tenants
            WHERE id = $1;
        `, [validTenantId]);

        return result.rows[0] ? this.mapTenantProfile(result.rows[0]) : null;
    }

    async updateTenantProfile(data: UpdateTenantProfileDTO): Promise<TenantProfile> {
        const tenantId = this.validateTenantId(data.tenantId);
        const result = await this.dbPool.query(`
            UPDATE tenants
            SET
                full_name = COALESCE($2, full_name),
                document = COALESCE($3, document),
                professional_id = COALESCE($4, professional_id),
                address = COALESCE($5, address),
                updated_at = NOW()
            WHERE id = $1
            RETURNING id, name, email, full_name, document, professional_id, address, totp_enabled;
        `, [
            tenantId,
            data.fullName !== undefined ? data.fullName : null,
            data.document !== undefined ? data.document : null,
            data.professionalId !== undefined ? data.professionalId : null,
            data.address !== undefined ? data.address : null
        ]);

        if (result.rows.length === 0) throw new NotFoundError('Tenant não encontrado');
        return this.mapTenantProfile(result.rows[0]);
    }

    async saveReceipt(data: SaveReceiptDTO): Promise<PsychotherapyReceipt> {
        const tenantId = this.validateTenantId(data.tenantId);
        
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
                return this.mapReceipt(result.rows[0]);
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

            // Insert the receipt with the sequence number
            const result = await client.query(`
                INSERT INTO psychotherapy_receipts (
                    id, tenant_id, patient_id, receipt_number, amount_cents, issue_date, description
                )
                VALUES (
                    COALESCE($1::uuid, gen_random_uuid()),
                    $2,
                    $3,
                    $4,
                    $5,
                    $6,
                    $7
                )
                RETURNING *;
            `, [
                data.id || null,
                tenantId,
                data.patientId,
                nextNumber,
                data.amountCents,
                data.issueDate,
                data.description
            ]);

            await client.query('COMMIT');
            return this.mapReceipt(result.rows[0]);
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

    async listReceipts(tenantId: string, patientId?: string): Promise<PsychotherapyReceipt[]> {
        const validTenantId = this.validateTenantId(tenantId);
        let query = 'SELECT * FROM psychotherapy_receipts WHERE tenant_id = $1';
        const params: any[] = [validTenantId];
        
        if (patientId) {
            query += ' AND patient_id = $2';
            params.push(patientId);
        }
        
        query += ' ORDER BY issue_date DESC, receipt_number DESC;';
        
        const result = await this.dbPool.query(query, params);
        return result.rows.map(row => this.mapReceipt(row));
    }

    async saveSession(data: SaveSessionDTO): Promise<PsychotherapySession> {
        const tenantId = this.validateTenantId(data.tenantId);
        const result = await this.dbPool.query(`
            INSERT INTO psychotherapy_sessions (
                id, tenant_id, patient_id, date, status, notes
            )
            VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO UPDATE SET
                date = EXCLUDED.date,
                status = EXCLUDED.status,
                notes = EXCLUDED.notes,
                updated_at = NOW()
            RETURNING *;
        `, [
            data.id || null,
            tenantId,
            data.patientId,
            data.date,
            data.status,
            data.notes || null
        ]);

        return this.mapSession(result.rows[0]);
    }

    async listSessions(
        tenantId: string,
        patientId?: string,
        start?: Date,
        end?: Date,
        pagination?: PaginationOptions
    ): Promise<PaginatedResult<PsychotherapySession>> {
        const validTenantId = this.validateTenantId(tenantId);
        let query = 'SELECT *, COUNT(*) OVER() AS total_count FROM psychotherapy_sessions WHERE tenant_id = $1';
        const params: any[] = [validTenantId];
        
        if (patientId) {
            params.push(patientId);
            query += ` AND patient_id = $${params.length}`;
        }
        
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
            data: result.rows.map(row => this.mapSession(row)),
            total
        };
    }

    async deleteSession(tenantId: string, id: string): Promise<void> {
        const validTenantId = this.validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            DELETE FROM psychotherapy_sessions
            WHERE tenant_id = $1 AND id = $2;
        `, [validTenantId, id]);

        if (result.rowCount === 0) throw new NotFoundError('Sessão não encontrada ou não autorizada');
    }

    async saveExpense(data: SaveExpenseDTO): Promise<PsychotherapyExpense> {
        const tenantId = this.validateTenantId(data.tenantId);
        const result = await this.dbPool.query(`
            INSERT INTO psychotherapy_expenses (
                id, tenant_id, date, amount_cents, description, category, fixed_expense_id, reference_month
            )
            VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id) DO UPDATE SET
                date = EXCLUDED.date,
                amount_cents = EXCLUDED.amount_cents,
                description = EXCLUDED.description,
                category = EXCLUDED.category,
                fixed_expense_id = EXCLUDED.fixed_expense_id,
                reference_month = EXCLUDED.reference_month,
                updated_at = NOW()
            RETURNING *;
        `, [
            data.id || null,
            tenantId,
            data.date,
            data.amountCents,
            data.description,
            data.category,
            data.fixedExpenseId || null,
            data.referenceMonth || null
        ]);

        return this.mapExpense(result.rows[0]);
    }

    async listExpenses(
        tenantId: string,
        start?: Date,
        end?: Date,
        pagination?: PaginationOptions
    ): Promise<PaginatedResult<PsychotherapyExpense>> {
        const validTenantId = this.validateTenantId(tenantId);

        // Auto-instantiate fixed expenses for current month and any months in start-end range
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
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
            data: result.rows.map(row => this.mapExpense(row)),
            total
        };
    }

    async deleteExpense(tenantId: string, id: string): Promise<void> {
        const validTenantId = this.validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            DELETE FROM psychotherapy_expenses
            WHERE tenant_id = $1 AND id = $2;
        `, [validTenantId, id]);

        if (result.rowCount === 0) throw new NotFoundError('Despesa não encontrada ou não autorizada');
    }

    async listFixedExpenses(tenantId: string): Promise<PsychotherapyFixedExpense[]> {
        const validTenantId = this.validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT * FROM psychotherapy_fixed_expenses
            WHERE tenant_id = $1
            ORDER BY day_of_month ASC, created_at DESC;
        `, [validTenantId]);

        return result.rows.map(row => this.mapFixedExpense(row));
    }

    async saveFixedExpense(data: SaveFixedExpenseDTO): Promise<PsychotherapyFixedExpense> {
        const tenantId = this.validateTenantId(data.tenantId);
        const result = await this.dbPool.query(`
            INSERT INTO psychotherapy_fixed_expenses (
                id, tenant_id, description, amount_cents, day_of_month, category, start_date, end_date, active
            )
            VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, COALESCE($9, TRUE))
            ON CONFLICT (id) DO UPDATE SET
                description = EXCLUDED.description,
                amount_cents = EXCLUDED.amount_cents,
                day_of_month = EXCLUDED.day_of_month,
                category = EXCLUDED.category,
                start_date = EXCLUDED.start_date,
                end_date = EXCLUDED.end_date,
                active = EXCLUDED.active,
                updated_at = NOW()
            WHERE psychotherapy_fixed_expenses.tenant_id = EXCLUDED.tenant_id
            RETURNING *;
        `, [
            data.id || null,
            tenantId,
            data.description,
            data.amountCents,
            data.dayOfMonth,
            data.category || null,
            data.startDate,
            data.endDate || null,
            data.active === undefined ? null : data.active
        ]);

        return this.mapFixedExpense(result.rows[0]);
    }

    async deleteFixedExpense(tenantId: string, id: string): Promise<void> {
        const validTenantId = this.validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            DELETE FROM psychotherapy_fixed_expenses
            WHERE tenant_id = $1 AND id = $2;
        `, [validTenantId, id]);

        if (result.rowCount === 0) {
            throw new NotFoundError('Despesa fixa não encontrada ou não autorizada');
        }
    }

    async toggleFixedExpense(tenantId: string, id: string, active: boolean): Promise<PsychotherapyFixedExpense> {
        const validTenantId = this.validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            UPDATE psychotherapy_fixed_expenses
            SET active = $3, updated_at = NOW()
            WHERE tenant_id = $1 AND id = $2
            RETURNING *;
        `, [validTenantId, id, active]);

        if (result.rows.length === 0) {
            throw new NotFoundError('Despesa fixa não encontrada ou não autorizada');
        }

        return this.mapFixedExpense(result.rows[0]);
    }

    async expenseExistsForMonth(tenantId: string, fixedExpenseId: string, month: string): Promise<boolean> {
        const validTenantId = this.validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT 1 FROM psychotherapy_expenses
            WHERE tenant_id = $1 AND fixed_expense_id = $2 AND reference_month = $3
            LIMIT 1;
        `, [validTenantId, fixedExpenseId, month]);

        return result.rows.length > 0;
    }

    private async checkAndInstantiateFixedExpenses(tenantId: string, monthStr: string): Promise<void> {
        const validTenantId = this.validateTenantId(tenantId);
        const fixedExpenses = await this.listFixedExpenses(validTenantId);
        
        for (const fe of fixedExpenses) {
            if (!fe.active) continue;
            
            const startMonth = fe.startDate.substring(0, 7); // YYYY-MM
            if (monthStr < startMonth) continue;
            
            if (fe.endDate) {
                const endMonth = fe.endDate.substring(0, 7); // YYYY-MM
                if (monthStr > endMonth) continue;
            }
            
            const exists = await this.expenseExistsForMonth(validTenantId, fe.id, monthStr);
            if (!exists) {
                const [yearStr, mStr] = monthStr.split('-');
                const year = parseInt(yearStr, 10);
                const monthIdx = parseInt(mStr, 10) - 1;
                const day = Math.min(fe.dayOfMonth, 28);
                const date = new Date(Date.UTC(year, monthIdx, day, 12, 0, 0));
                
                await this.saveExpense({
                    tenantId: validTenantId,
                    date,
                    amountCents: fe.amountCents,
                    description: fe.description,
                    category: (fe.category || 'other') as any,
                    fixedExpenseId: fe.id,
                    referenceMonth: monthStr
                });
            }
        }
    }

    async getDashboardAnalytics(tenantId: string, currentMonthStr: string): Promise<DashboardAnalytics> {
        const validTenantId = this.validateTenantId(tenantId);

        const [year, month] = currentMonthStr.split('-');
        const currentYearNum = parseInt(year, 10);
        const currentMonthNum = parseInt(month, 10);

        // Date range calculation (UTC to avoid timezone offsets)
        // If currentMonth is 2026-06, range starts 2026-01-01 and ends before 2026-07-01
        const startDate = new Date(Date.UTC(currentYearNum, currentMonthNum - 6, 1));
        const endDate = new Date(Date.UTC(currentYearNum, currentMonthNum, 1));

        // Auto-instantiate fixed expenses for the 6 months trend
        let tempDate = new Date(startDate);
        while (tempDate < endDate) {
            const mStr = `${tempDate.getUTCFullYear()}-${String(tempDate.getUTCMonth() + 1).padStart(2, '0')}`;
            await this.checkAndInstantiateFixedExpenses(validTenantId, mStr);
            tempDate.setUTCMonth(tempDate.getUTCMonth() + 1);
        }

        // Query 1: Trend of revenue and expenses for the 6 months (includes the current month)
        // Revenue sourced from monthly_records so payments marked in Faturamento Mensal
        // appear here — not just formally issued receipts.
        // Formula: session_price_cents * paid_sessions for ALL payment types.
        // Regardless of monthly vs per_session billing, each paid session represents
        // real cash received. The distinction only matters for pending calculations.
        const startMonthStr = `${startDate.getUTCFullYear()}-${String(startDate.getUTCMonth() + 1).padStart(2, '0')}`;
        const endMonthStr = `${endDate.getUTCFullYear()}-${String(endDate.getUTCMonth() + 1).padStart(2, '0')}`;
        const trendResult = await this.dbPool.query(`
            WITH monthly_records_revenue AS (
                SELECT month, COALESCE(SUM(
                    COALESCE(session_price_cents, 0) * paid_sessions + previous_month_paid_cents
                ), 0) as total
                FROM psychotherapy_monthly_records
                WHERE tenant_id = $1 AND month >= $4 AND month < $5
                GROUP BY 1
            ),
            group_payments_revenue AS (
                SELECT reference_month AS month, COALESCE(SUM(amount_cents), 0) AS total
                FROM group_payments
                WHERE tenant_id = $1 AND reference_month >= $4 AND reference_month < $5
                GROUP BY 1
            ),
            combined_revenue AS (
                SELECT month, SUM(total) AS total
                FROM (
                    SELECT month, total FROM monthly_records_revenue
                    UNION ALL
                    SELECT month, total FROM group_payments_revenue
                ) all_revenue
                GROUP BY 1
            ),
            expenses_by_month AS (
                SELECT TO_CHAR(date, 'YYYY-MM') as month, COALESCE(SUM(amount_cents), 0) as total
                FROM psychotherapy_expenses
                WHERE tenant_id = $1 AND date >= $2 AND date < $3
                GROUP BY 1
            )
            SELECT
                COALESCE(r.month, e.month) as month,
                COALESCE(r.total, 0) as revenue,
                COALESCE(mr.total, 0) as session_revenue,
                COALESCE(e.total, 0) as expenses
            FROM combined_revenue r
            LEFT JOIN monthly_records_revenue mr ON r.month = mr.month
            FULL OUTER JOIN expenses_by_month e ON r.month = e.month
        `, [validTenantId, startDate, endDate, startMonthStr, endMonthStr]);

        // Query 2: Pending amount in cents for the current month
        const pendingResult = await this.dbPool.query(`
            SELECT COALESCE(SUM(
                CASE 
                    WHEN payment_type = 'monthly' THEN
                        GREATEST(session_price_cents - (session_price_cents * paid_sessions / GREATEST(expected_sessions - absences, 1)), 0)
                    ELSE
                        GREATEST(expected_sessions - absences - paid_sessions, 0) * COALESCE(session_price_cents, 0)
                END
            ), 0) as pending
            FROM psychotherapy_monthly_records
            WHERE tenant_id = $1 AND month < $2 AND payment_status != 'paid'
        `, [validTenantId, currentMonthStr]);

        const pendingCents = parseInt(pendingResult.rows[0].pending, 10);

        // Map trend results to a lookup map
        const dbTrendMap = new Map<string, { revenue: number; sessionRevenue: number; expenses: number }>();
        for (const row of trendResult.rows) {
            dbTrendMap.set(row.month, {
                revenue: parseInt(row.revenue, 10),
                sessionRevenue: parseInt(row.session_revenue, 10),
                expenses: parseInt(row.expenses, 10)
            });
        }

        // Construct list of 6 months chronological
        const monthsList: string[] = [];
        let d = new Date(Date.UTC(currentYearNum, currentMonthNum - 6, 1));
        for (let i = 0; i < 6; i++) {
            const yyyy = d.getUTCFullYear();
            const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
            monthsList.push(`${yyyy}-${mm}`);
            d.setUTCMonth(d.getUTCMonth() + 1);
        }

        const sixMonthsTrend = monthsList.map(m => {
            const data = dbTrendMap.get(m) || { revenue: 0, sessionRevenue: 0, expenses: 0 };
            return {
                month: m,
                revenueCents: data.revenue,
                expensesCents: data.expenses
            };
        });

        // Current month values from trend
        const currentMonthData = dbTrendMap.get(currentMonthStr) || { revenue: 0, sessionRevenue: 0, expenses: 0 };
        const revenueCents = currentMonthData.revenue;
        const sessionRevenueCents = currentMonthData.sessionRevenue;
        const expensesCents = currentMonthData.expenses;

        return {
            currentMonth: {
                revenueCents,
                sessionRevenueCents,
                expensesCents,
                netIncomeCents: revenueCents - expensesCents,
                pendingCents
            },
            sixMonthsTrend
        };
    }

    // ── Appointments ──────────────────────────────────────────────────────────

    async saveAppointment(data: SaveAppointmentDTO): Promise<PsychotherapyAppointment> {
        const tenantId = this.validateTenantId(data.tenantId);

        // Pré-leitura do mês antigo (para reagendamentos)
        let oldMonth: string | null = null;
        if (data.id) {
            const prev = await this.dbPool.query(
                `SELECT scheduled_at FROM psychotherapy_appointments
                 WHERE id = $1 AND tenant_id = $2`,
                [data.id, tenantId]
            );
            if (prev.rows[0]) {
                oldMonth = toMonthStr(new Date(prev.rows[0].scheduled_at));
            }
        }

        const result = await this.dbPool.query(`
            INSERT INTO psychotherapy_appointments (
                id, tenant_id, patient_id, scheduled_at, duration_minutes,
                status, recurrence, recurrence_end_date, notes, parent_id
            )
            VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (id) DO UPDATE SET
                patient_id = EXCLUDED.patient_id,
                scheduled_at = EXCLUDED.scheduled_at,
                duration_minutes = EXCLUDED.duration_minutes,
                status = EXCLUDED.status,
                recurrence = EXCLUDED.recurrence,
                recurrence_end_date = EXCLUDED.recurrence_end_date,
                notes = EXCLUDED.notes,
                parent_id = EXCLUDED.parent_id,
                updated_at = NOW()
            WHERE psychotherapy_appointments.tenant_id = EXCLUDED.tenant_id
            RETURNING *;
        `, [
            data.id || null,
            tenantId,
            data.patientId,
            data.scheduledAt,
            data.durationMinutes ?? 50,
            data.status ?? 'scheduled',
            data.recurrence ?? 'none',
            data.recurrenceEndDate ?? null,
            data.notes ?? null,
            data.parentId || null
        ]);

        if (result.rows.length === 0) throw new NotFoundError('Agendamento não encontrado ou não autorizado');
        const appointment = this.mapAppointment(result.rows[0]);

        const newMonth = toMonthStr(data.scheduledAt);
        await this.syncMonthlyRecord(this.dbPool, tenantId, data.patientId, newMonth);
        if (oldMonth && oldMonth !== newMonth) {
            await this.syncMonthlyRecord(this.dbPool, tenantId, data.patientId, oldMonth);
        }

        return appointment;
    }

    async listAppointments(tenantId: string, options: ListAppointmentsOptions = {}): Promise<PaginatedResult<PsychotherapyAppointment>> {
        const validTenantId = this.validateTenantId(tenantId);
        const params: unknown[] = [validTenantId];
        let whereClause = 'WHERE tenant_id = $1';

        if (options.patientId) {
            params.push(options.patientId);
            whereClause += ` AND patient_id = $${params.length}`;
        }
        if (options.start) {
            params.push(options.start);
            whereClause += ` AND scheduled_at >= $${params.length}`;
        }
        if (options.end) {
            params.push(options.end);
            whereClause += ` AND scheduled_at <= $${params.length}`;
        }

        const page = options.page ?? 1;
        const limit = options.limit ?? 50;
        const offset = (page - 1) * limit;
        params.push(limit, offset);

        const result = await this.dbPool.query(`
            SELECT *, COUNT(*) OVER() AS total_count
            FROM psychotherapy_appointments
            ${whereClause}
            ORDER BY scheduled_at ASC
            LIMIT $${params.length - 1} OFFSET $${params.length};
        `, params);

        if (result.rows.length === 0) return { data: [], total: 0 };
        const total = parseInt(result.rows[0].total_count, 10);
        return {
            data: result.rows.map(row => this.mapAppointment(row)),
            total
        };
    }

    async findAppointmentById(tenantId: string, id: string): Promise<PsychotherapyAppointment | null> {
        const validTenantId = this.validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT * FROM psychotherapy_appointments
            WHERE tenant_id = $1 AND id = $2;
        `, [validTenantId, id]);
        return result.rows[0] ? this.mapAppointment(result.rows[0]) : null;
    }

    async deleteAppointment(tenantId: string, id: string): Promise<void> {
        const validTenantId = this.validateTenantId(tenantId);
        const client = await this.dbPool.connect();

        try {
            await client.query('BEGIN');

            // 1. Lê o agendamento + dados do paciente antes de deletar
            const appQuery = await client.query(`
                SELECT
                    a.patient_id, a.scheduled_at, a.status,
                    p.payment_type, p.default_session_price_cents,
                    p.name AS patient_name, p.status AS patient_status
                FROM psychotherapy_appointments a
                JOIN psychotherapy_patients p ON p.id = a.patient_id
                WHERE a.tenant_id = $1 AND a.id = $2
            `, [validTenantId, id]);

            if (appQuery.rows.length === 0)
                throw new NotFoundError('Agendamento não encontrado ou não autorizado');

            const { patient_id, scheduled_at, status, payment_type } = appQuery.rows[0];

            // 3. Remove sessão correspondente (somente se sem notas clínicas)
            await client.query(`
                DELETE FROM psychotherapy_sessions
                WHERE tenant_id = $1 AND patient_id = $2 AND date = $3
                  AND (notes IS NULL OR TRIM(notes) = '')
                  AND NOT EXISTS (
                      SELECT 1 FROM psychotherapy_clinical_notes
                      WHERE session_id = psychotherapy_sessions.id
                  )
            `, [validTenantId, patient_id, scheduled_at]);

            // 4. Deleta o agendamento
            const del = await client.query(`
                DELETE FROM psychotherapy_appointments
                WHERE tenant_id = $1 AND id = $2
            `, [validTenantId, id]);

            if (del.rowCount === 0)
                throw new NotFoundError('Agendamento não encontrado ou não autorizado');

            await this.syncMonthlyRecord(
                client,
                validTenantId,
                patient_id,
                toMonthStr(new Date(scheduled_at))
            );

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    async updateAppointmentStatus(tenantId: string, id: string, status: AppointmentStatus): Promise<PsychotherapyAppointment> {
        const validTenantId = this.validateTenantId(tenantId);
        const client = await this.dbPool.connect();

        try {
            await client.query('BEGIN');

            // ── Pré-leitura: old_status + dados do paciente ───────────────────
            const preQuery = await client.query(`
                SELECT
                    a.patient_id, a.scheduled_at, a.status AS old_status,
                    p.name   AS patient_name,
                    p.status AS patient_status,
                    p.payment_type,
                    p.default_session_price_cents
                FROM psychotherapy_appointments a
                JOIN psychotherapy_patients p ON p.id = a.patient_id
                WHERE a.tenant_id = $1 AND a.id = $2
            `, [validTenantId, id]);

            if (preQuery.rows.length === 0)
                throw new NotFoundError('Agendamento não encontrado ou não autorizado');

            const {
                patient_id, scheduled_at,
                old_status,
                patient_name, patient_status,
                payment_type, default_session_price_cents,
            } = preQuery.rows[0];

            // ── 1. Atualiza status ────────────────────────────────────────────
            const result = await client.query(`
                UPDATE psychotherapy_appointments
                SET status = $1, updated_at = NOW()
                WHERE tenant_id = $2 AND id = $3
                RETURNING *;
            `, [status, validTenantId, id]);

            const appointment = result.rows[0];

            // ── 2. Sincronização com o Diário de Sessões ──────────────────────
            if (status === 'attended' || status === 'no_show' || status === 'canceled') {
                const targetSessionStatus =
                    status === 'attended'  ? 'attended' :
                    status === 'no_show'   ? 'unjustified_absence' : 'canceled';

                const sessionCheck = await client.query(`
                    SELECT id FROM psychotherapy_sessions
                    WHERE tenant_id = $1 AND patient_id = $2 AND date = $3
                    LIMIT 1;
                `, [validTenantId, patient_id, scheduled_at]);

                if (sessionCheck.rows.length > 0) {
                    await client.query(`
                        UPDATE psychotherapy_sessions
                        SET status = $1, notes = COALESCE($2, notes), updated_at = NOW()
                        WHERE id = $3;
                    `, [targetSessionStatus, appointment.notes, sessionCheck.rows[0].id]);
                } else {
                    await client.query(`
                        INSERT INTO psychotherapy_sessions (id, tenant_id, patient_id, date, status, notes)
                        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5);
                    `, [validTenantId, patient_id, scheduled_at, targetSessionStatus, appointment.notes]);
                }
            } else if (status === 'scheduled' || status === 'confirmed') {
                await client.query(`
                    DELETE FROM psychotherapy_sessions
                    WHERE tenant_id = $1 AND patient_id = $2 AND date = $3
                      AND (notes IS NULL OR TRIM(notes) = '')
                      AND NOT EXISTS (
                          SELECT 1 FROM psychotherapy_clinical_notes
                          WHERE session_id = psychotherapy_sessions.id
                      );
                `, [validTenantId, patient_id, scheduled_at]);
            }

            await this.syncMonthlyRecord(
                client,
                validTenantId,
                patient_id,
                toMonthStr(new Date(scheduled_at))
            );

            await client.query('COMMIT');
            return this.mapAppointment(appointment);
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async findUpcomingAppointments(windowStart: Date, windowEnd: Date): Promise<UpcomingAppointment[]> {
        const result = await this.dbPool.query(`
            SELECT
                a.id            AS appointment_id,
                a.tenant_id,
                t.name          AS tenant_name,
                a.patient_id,
                p.name          AS patient_name,
                p.phone         AS patient_phone,
                p.email         AS patient_email,
                p.reminder_channel,
                a.scheduled_at,
                a.duration_minutes
            FROM psychotherapy_appointments a
            JOIN psychotherapy_patients p ON p.id = a.patient_id
            JOIN tenants t ON t.id = a.tenant_id
            WHERE a.scheduled_at >= $1
              AND a.scheduled_at < $2
              AND a.status IN ('scheduled', 'confirmed')
              AND p.reminder_channel <> 'none'
            ORDER BY a.scheduled_at ASC;
        `, [windowStart, windowEnd]);

        return result.rows.map(row => ({
            appointmentId:  row.appointment_id,
            tenantId:       row.tenant_id,
            tenantName:     row.tenant_name,
            patientId:      row.patient_id,
            patientName:    row.patient_name,
            patientPhone:   row.patient_phone,
            patientEmail:   row.patient_email,
            reminderChannel: row.reminder_channel ?? 'whatsapp',
            scheduledAt:    new Date(row.scheduled_at),
            durationMinutes: row.duration_minutes,
        }));
    }

    async markReminderSent(
        appointmentId: string,
        tenantId: string,
        channelUsed: 'whatsapp' | 'email',
        status: 'success' | 'failed',
        errorMessage?: string
    ): Promise<void> {
        await this.dbPool.query(`
            INSERT INTO psychotherapy_reminders_log
                (tenant_id, appointment_id, channel_used, status, error_message)
            VALUES ($1, $2, $3, $4, $5);
        `, [tenantId, appointmentId, channelUsed, status, errorMessage ?? null]);
    }

    async hasReminderBeenSent(appointmentId: string, channelUsed: 'whatsapp' | 'email'): Promise<boolean> {
        const result = await this.dbPool.query(`
            SELECT 1 FROM psychotherapy_reminders_log
            WHERE appointment_id = $1
              AND channel_used = $2
              AND status = 'success'
            LIMIT 1;
        `, [appointmentId, channelUsed]);
        return result.rows.length > 0;
    }

    // ── Google OAuth Tokens ───────────────────────────────────────────────────

    async saveGoogleOAuthTokens(tenantId: string, accessToken: string, refreshToken: string, expiryDate: number, calendarId?: string): Promise<void> {
        const validTenantId = this.validateTenantId(tenantId);
        await this.dbPool.query(`
            INSERT INTO google_oauth_tokens (tenant_id, access_token, refresh_token, expiry_date, calendar_id)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (tenant_id) DO UPDATE SET
                access_token = EXCLUDED.access_token,
                refresh_token = EXCLUDED.refresh_token,
                expiry_date = EXCLUDED.expiry_date,
                calendar_id = COALESCE($5, google_oauth_tokens.calendar_id),
                updated_at = NOW();
        `, [validTenantId, accessToken, refreshToken, expiryDate, calendarId ?? null]);
    }

    async getGoogleOAuthTokens(tenantId: string): Promise<GoogleOAuthTokens | null> {
        const validTenantId = this.validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT tenant_id, access_token, refresh_token, expiry_date, calendar_id
            FROM google_oauth_tokens WHERE tenant_id = $1;
        `, [validTenantId]);
        if (!result.rows[0]) return null;
        const row = result.rows[0];
        return {
            tenantId: row.tenant_id,
            accessToken: row.access_token,
            refreshToken: row.refresh_token,
            expiryDate: row.expiry_date ? Number(row.expiry_date) : null,
            calendarId: row.calendar_id
        };
    }

    async updateGoogleAccessToken(tenantId: string, accessToken: string, expiryDate: number): Promise<void> {
        const validTenantId = this.validateTenantId(tenantId);
        await this.dbPool.query(`
            UPDATE google_oauth_tokens SET access_token = $2, expiry_date = $3, updated_at = NOW()
            WHERE tenant_id = $1;
        `, [validTenantId, accessToken, expiryDate]);
    }

    async listAllGoogleOAuthTokens(): Promise<GoogleOAuthTokens[]> {
        const result = await this.dbPool.query(`
            SELECT tenant_id, access_token, refresh_token, expiry_date, calendar_id
            FROM google_oauth_tokens
            WHERE refresh_token IS NOT NULL AND calendar_id IS NOT NULL;
        `);
        return result.rows.map(row => ({
            tenantId: row.tenant_id,
            accessToken: row.access_token,
            refreshToken: row.refresh_token,
            expiryDate: row.expiry_date ? Number(row.expiry_date) : null,
            calendarId: row.calendar_id
        }));
    }

    async findAppointmentByGoogleEventId(tenantId: string, googleEventId: string): Promise<PsychotherapyAppointment | null> {
        const validTenantId = this.validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT * FROM psychotherapy_appointments
            WHERE tenant_id = $1 AND google_event_id = $2;
        `, [validTenantId, googleEventId]);
        return result.rows[0] ? this.mapAppointment(result.rows[0]) : null;
    }

    async updateAppointmentGoogleEvent(id: string, tenantId: string, googleEventId: string, googleEventUrl: string): Promise<void> {
        const validTenantId = this.validateTenantId(tenantId);
        await this.dbPool.query(`
            UPDATE psychotherapy_appointments
            SET google_event_id = $3, google_event_url = $4, updated_at = NOW()
            WHERE id = $1 AND tenant_id = $2;
        `, [id, validTenantId, googleEventId, googleEventUrl]);
    }

    async findAppointmentByConfirmToken(token: string): Promise<PsychotherapyAppointment | null> {
        const result = await this.dbPool.query(`
            SELECT * FROM psychotherapy_appointments WHERE confirm_token = $1::uuid;
        `, [token]);
        return result.rows[0] ? this.mapAppointment(result.rows[0]) : null;
    }

    async confirmAppointmentByToken(token: string): Promise<PsychotherapyAppointment | null> {
        const result = await this.dbPool.query(`
            UPDATE psychotherapy_appointments
            SET status = 'confirmed', confirmed_at = NOW(), updated_at = NOW()
            WHERE confirm_token = $1::uuid AND status = 'scheduled'
            RETURNING *;
        `, [token]);
        return result.rows[0] ? this.mapAppointment(result.rows[0]) : null;
    }

    // ── Clinical Notes ────────────────────────────────────────────────────────

    async saveClinicalNote(data: SaveClinicalNoteDTO): Promise<ClinicalNote> {
        const tenantId = this.validateTenantId(data.tenantId);
        const result = await this.dbPool.query(`
            INSERT INTO psychotherapy_clinical_notes (
                id, tenant_id, patient_id, session_id, note_date, content, tags
            )
            VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7)
            ON CONFLICT (id) DO UPDATE SET
                session_id = EXCLUDED.session_id,
                note_date = EXCLUDED.note_date,
                content = EXCLUDED.content,
                tags = EXCLUDED.tags,
                updated_at = NOW()
            WHERE psychotherapy_clinical_notes.tenant_id = EXCLUDED.tenant_id
            RETURNING *;
        `, [
            data.id || null,
            tenantId,
            data.patientId,
            data.sessionId ?? null,
            data.noteDate,
            data.content,
            data.tags ?? []
        ]);

        if (result.rows.length === 0) throw new NotFoundError('Nota clínica não encontrada ou não autorizada');
        return this.mapClinicalNote(result.rows[0]);
    }

    async listClinicalNotes(tenantId: string, patientId: string, page = 1, limit = 20): Promise<PaginatedResult<ClinicalNote>> {
        const validTenantId = this.validateTenantId(tenantId);
        const offset = (page - 1) * limit;

        const result = await this.dbPool.query(`
            SELECT *, COUNT(*) OVER() AS total_count
            FROM psychotherapy_clinical_notes
            WHERE tenant_id = $1 AND patient_id = $2
            ORDER BY note_date DESC, created_at DESC
            LIMIT $3 OFFSET $4;
        `, [validTenantId, patientId, limit, offset]);

        if (result.rows.length === 0) return { data: [], total: 0 };
        const total = parseInt(result.rows[0].total_count, 10);
        return {
            data: result.rows.map(row => this.mapClinicalNote(row)),
            total
        };
    }

    async findClinicalNoteById(tenantId: string, id: string): Promise<ClinicalNote | null> {
        const validTenantId = this.validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT * FROM psychotherapy_clinical_notes
            WHERE tenant_id = $1 AND id = $2;
        `, [validTenantId, id]);
        return result.rows[0] ? this.mapClinicalNote(result.rows[0]) : null;
    }

    async deleteClinicalNote(tenantId: string, id: string): Promise<void> {
        const validTenantId = this.validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            DELETE FROM psychotherapy_clinical_notes
            WHERE tenant_id = $1 AND id = $2;
        `, [validTenantId, id]);
        if (result.rowCount === 0) throw new NotFoundError('Nota clínica não encontrada ou não autorizada');
    }

    // ── Availability Slots ────────────────────────────────────────────────────

    async saveAvailabilitySlot(data: SaveAvailabilitySlotDTO): Promise<AvailabilitySlot> {
        const tenantId = this.validateTenantId(data.tenantId);
        const result = await this.dbPool.query(`
            INSERT INTO psychotherapy_availability_slots
                (id, tenant_id, day_of_week, start_time, duration_minutes, is_active, notes, recurrence_type, start_date, modality)
            VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (id) DO UPDATE SET
                day_of_week      = EXCLUDED.day_of_week,
                start_time       = EXCLUDED.start_time,
                duration_minutes = EXCLUDED.duration_minutes,
                is_active        = EXCLUDED.is_active,
                notes            = EXCLUDED.notes,
                recurrence_type  = EXCLUDED.recurrence_type,
                start_date       = EXCLUDED.start_date,
                modality         = EXCLUDED.modality,
                updated_at       = NOW()
            RETURNING *;
        `, [
            data.id ?? null,
            tenantId,
            data.dayOfWeek,
            data.startTime,
            data.durationMinutes ?? 50,
            data.isActive ?? true,
            data.notes ?? null,
            data.recurrenceType ?? 'weekly',
            data.startDate ?? null,
            data.modality ?? 'presencial'
        ]);
        return this.mapAvailabilitySlot(result.rows[0]);
    }

    async listAvailabilitySlots(tenantId: string): Promise<AvailabilitySlot[]> {
        const validTenantId = this.validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT * FROM psychotherapy_availability_slots
            WHERE tenant_id = $1
            ORDER BY day_of_week, start_time;
        `, [validTenantId]);
        return result.rows.map(row => this.mapAvailabilitySlot(row));
    }

    async deleteAvailabilitySlot(tenantId: string, id: string): Promise<void> {
        const validTenantId = this.validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            DELETE FROM psychotherapy_availability_slots WHERE tenant_id = $1 AND id = $2;
        `, [validTenantId, id]);
        if (result.rowCount === 0) throw new NotFoundError('Horário não encontrado ou não autorizado');
    }

    async listActiveAppointmentDatetimes(tenantId: string, from: Date, to: Date): Promise<Date[]> {
        const validTenantId = this.validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT scheduled_at FROM psychotherapy_appointments
            WHERE tenant_id = $1
              AND scheduled_at >= $2
              AND scheduled_at < $3
              AND status NOT IN ('canceled', 'no_show');
        `, [validTenantId, from, to]);
        return result.rows.map(r => new Date(r.scheduled_at));
    }

    // ── Booking Links ──────────────────────────────────────────────────────────

    async upsertBookingLink(tenantId: string, patientId: string, expiresAt?: Date | null): Promise<BookingLink> {
        const validTenantId = this.validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            INSERT INTO psychotherapy_booking_links (tenant_id, patient_id, expires_at, is_active)
            VALUES ($1, $2, $3, TRUE)
            ON CONFLICT (tenant_id, patient_id) DO UPDATE SET
                token      = gen_random_uuid(),
                expires_at = EXCLUDED.expires_at,
                is_active  = TRUE,
                updated_at = NOW()
            RETURNING *;
        `, [validTenantId, patientId, expiresAt ?? null]);
        return this.mapBookingLink(result.rows[0]);
    }

    async findBookingLinkByToken(token: string): Promise<BookingLink | null> {
        const result = await this.dbPool.query(`
            SELECT * FROM psychotherapy_booking_links WHERE token = $1::uuid;
        `, [token]);
        return result.rows[0] ? this.mapBookingLink(result.rows[0]) : null;
    }

    async deactivateBookingLink(tenantId: string, patientId: string): Promise<void> {
        const validTenantId = this.validateTenantId(tenantId);
        await this.dbPool.query(`
            UPDATE psychotherapy_booking_links SET is_active = FALSE, updated_at = NOW()
            WHERE tenant_id = $1 AND patient_id = $2;
        `, [validTenantId, patientId]);
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private validateTenantId(tenantId: string): string {
        if (!UUID_REGEX.test(tenantId)) {
            throw new Error(`TenantId inválido: "${tenantId}". Esperado UUID v1-v5.`);
        }
        return tenantId;
    }

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

    private mapPatient(row: PatientRow): PsychotherapyPatient {
        return new PsychotherapyPatient(
            row.id,
            row.tenant_id,
            row.name,
            row.status,
            row.payment_type,
            row.default_session_price_cents,
            row.notes,
            row.document,
            row.phone,
            row.email,
            new Date(row.created_at),
            new Date(row.updated_at),
            row.reminder_channel ?? 'whatsapp',
            row.full_name ?? null
        );
    }

    private mapMonthlyRecord(row: MonthlyRecordRow): PsychotherapyMonthlyRecord {
        return new PsychotherapyMonthlyRecord(
            row.id,
            row.tenant_id,
            row.patient_id,
            row.month,
            row.patient_name_snapshot,
            row.status,
            row.payment_type,
            row.session_price_cents,
            row.expected_sessions,
            row.paid_sessions,
            row.absences,
            row.payment_status,
            row.notes,
            row.previous_month_paid_cents,
            new Date(row.created_at),
            new Date(row.updated_at)
        );
    }

    private mapTenantProfile(row: TenantProfileRow): TenantProfile {
        return new TenantProfile(
            row.id,
            row.name,
            row.email,
            row.full_name,
            row.document,
            row.professional_id,
            row.address,
            row.totp_enabled || false
        );
    }

    private mapReceipt(row: ReceiptRow): PsychotherapyReceipt {
        return new PsychotherapyReceipt(
            row.id,
            row.tenant_id,
            row.patient_id,
            row.receipt_number,
            row.amount_cents,
            new Date(row.issue_date),
            row.description,
            new Date(row.created_at),
            new Date(row.updated_at)
        );
    }

    private mapSession(row: SessionRow): PsychotherapySession {
        return {
            id: row.id,
            tenantId: row.tenant_id,
            patientId: row.patient_id,
            date: new Date(row.date),
            status: row.status,
            notes: row.notes ?? undefined,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at)
        };
    }

    private mapExpense(row: ExpenseRow): PsychotherapyExpense {
        return {
            id: row.id,
            tenantId: row.tenant_id,
            date: new Date(row.date),
            amountCents: row.amount_cents,
            description: row.description,
            category: row.category,
            fixedExpenseId: row.fixed_expense_id,
            referenceMonth: row.reference_month,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at)
        };
    }

    private mapFixedExpense(row: FixedExpenseRow): PsychotherapyFixedExpense {
        const startDateStr = this.formatDate(row.start_date) || '';
        const endDateStr = this.formatDate(row.end_date);
        return new PsychotherapyFixedExpense(
            row.id,
            row.tenant_id,
            row.description,
            row.amount_cents,
            row.day_of_month,
            row.category,
            startDateStr,
            endDateStr,
            row.active,
            new Date(row.created_at),
            new Date(row.updated_at)
        );
    }

    private formatDate(d: any): string | null {
        if (!d) return null;
        if (d instanceof Date) {
            return d.toISOString().split('T')[0];
        }
        if (typeof d === 'string') {
            return d.split('T')[0];
        }
        return String(d);
    }

    private mapAvailabilitySlot(row: AvailabilitySlotRow): AvailabilitySlot {
        return new AvailabilitySlot(
            row.id, row.tenant_id, row.day_of_week,
            typeof row.start_time === 'string' ? row.start_time.slice(0, 5) : String(row.start_time),
            row.duration_minutes, row.is_active, row.notes,
            new Date(row.created_at), new Date(row.updated_at),
            (row.recurrence_type ?? 'weekly') as AvailabilityRecurrenceType,
            row.start_date ? new Date(row.start_date) : null,
            (row.modality ?? 'presencial') as AvailabilityModality
        );
    }

    private mapBookingLink(row: BookingLinkRow): BookingLink {
        return new BookingLink(
            row.id, row.token, row.tenant_id, row.patient_id,
            row.expires_at ? new Date(row.expires_at) : null,
            row.is_active, new Date(row.created_at), new Date(row.updated_at)
        );
    }

    private mapClinicalNote(row: ClinicalNoteRow): ClinicalNote {
        return new ClinicalNote(
            row.id,
            row.tenant_id,
            row.patient_id,
            row.session_id,
            new Date(row.note_date),
            row.content,
            row.tags ?? [],
            new Date(row.created_at),
            new Date(row.updated_at)
        );
    }

    private async syncMonthlyRecord(
        client: Pool | PoolClient,
        tenantId: string,
        patientId: string,
        month: string
    ): Promise<void> {
        const patientRes = await client.query(`
            SELECT name, status, payment_type, default_session_price_cents
            FROM psychotherapy_patients
            WHERE tenant_id = $1 AND id = $2
        `, [tenantId, patientId]);

        if (patientRes.rows.length === 0) return;
        const patient = patientRes.rows[0];

        // month = 'YYYY-MM'; BRT = UTC-3 (sem horário de verão desde 2019)
        const monthStart = new Date(`${month}-01T03:00:00.000Z`);
        const monthEnd   = new Date(monthStart);
        monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);

        const apptsRes = await client.query(`
            SELECT
                COUNT(*) FILTER (WHERE status != 'canceled') AS active_count,
                COUNT(*) FILTER (WHERE status = 'no_show')   AS no_show_count
            FROM psychotherapy_appointments
            WHERE tenant_id = $1 AND patient_id = $2
              AND scheduled_at >= $3 AND scheduled_at < $4
        `, [tenantId, patientId, monthStart, monthEnd]);

        const activeCount = parseInt(apptsRes.rows[0].active_count, 10);
        const absences    = parseInt(apptsRes.rows[0].no_show_count, 10);

        const SESSIONS_BY_STATUS: Record<string, number> = {
            weekly: 4, biweekly: 2, one_off: 0, inactive: 0,
        };
        const defaultSessions  = SESSIONS_BY_STATUS[patient.status] ?? 0;
        const expectedSessions = Math.max(defaultSessions, activeCount);

        // Se não há sessões esperadas nem pagas, limpar o registro e sair
        if (expectedSessions === 0) {
            await client.query(`
                DELETE FROM psychotherapy_monthly_records
                WHERE tenant_id = $1 AND patient_id = $2 AND month = $3
                  AND paid_sessions = 0
            `, [tenantId, patientId, month]);
            return;
        }

        await client.query(`
            INSERT INTO psychotherapy_monthly_records (
                id, tenant_id, patient_id, month,
                patient_name_snapshot, status, payment_type,
                session_price_cents, expected_sessions, absences,
                paid_sessions, payment_status, previous_month_paid_cents
            ) VALUES (
                gen_random_uuid(), $1, $2, $3,
                $4, $5, $6, $7, $8, $9,
                0, 'pending', 0
            )
            ON CONFLICT (tenant_id, month, patient_id) WHERE patient_id IS NOT NULL
            DO UPDATE SET
                patient_name_snapshot = EXCLUDED.patient_name_snapshot,
                status                = EXCLUDED.status,
                payment_type          = EXCLUDED.payment_type,
                expected_sessions     = EXCLUDED.expected_sessions,
                absences              = EXCLUDED.absences,
                payment_status = CASE
                    WHEN psychotherapy_monthly_records.paid_sessions >=
                         GREATEST(EXCLUDED.expected_sessions - EXCLUDED.absences, 0)
                         AND GREATEST(EXCLUDED.expected_sessions - EXCLUDED.absences, 0) > 0
                        THEN 'paid'
                    WHEN psychotherapy_monthly_records.paid_sessions > 0 THEN 'partial'
                    ELSE 'pending'
                END,
                updated_at = NOW()
        `, [
            tenantId, patientId, month,
            patient.name, patient.status, patient.payment_type,
            patient.default_session_price_cents, expectedSessions, absences
        ]);
    }

    private mapAppointment(row: AppointmentRow): PsychotherapyAppointment {
        return new PsychotherapyAppointment(
            row.id,
            row.tenant_id,
            row.patient_id,
            new Date(row.scheduled_at),
            row.duration_minutes,
            row.status,
            row.recurrence,
            row.recurrence_end_date ? new Date(row.recurrence_end_date) : null,
            row.notes,
            row.google_event_id ?? null,
            row.google_event_url ?? null,
            row.confirm_token ?? null,
            row.confirmed_at ? new Date(row.confirmed_at) : null,
            row.parent_id ?? null,
            new Date(row.created_at),
            new Date(row.updated_at)
        );
    }

    async listSeriesAppointments(tenantId: string, rootId: string): Promise<PsychotherapyAppointment[]> {
        const result = await this.dbPool.query(
            `SELECT * FROM psychotherapy_appointments
             WHERE tenant_id = $1 AND (id = $2 OR parent_id = $2)
             ORDER BY scheduled_at ASC`,
            [tenantId, rootId]
        );
        return result.rows.map(row => this.mapAppointment(row));
    }
}
