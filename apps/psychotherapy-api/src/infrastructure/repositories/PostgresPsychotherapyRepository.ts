import { Pool } from 'pg';
import crypto from 'crypto';
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
import { PASTORAL_SENTINEL_EMAIL } from '../../domain/constants/pastoral';
import { PsychotherapySession } from '../../domain/models/PsychotherapySession';
import { PsychotherapyExpense } from '../../domain/models/PsychotherapyExpense';
import { PsychotherapyFixedExpense } from '../../domain/models/PsychotherapyFixedExpense';
import { DashboardAnalytics, PendingDetails, PendingPatientDetail, PendingSessionDetail, SaveExpenseDTO, SaveSessionDTO, SaveClinicalNoteDTO, SaveFixedExpenseDTO, AddAdvanceCreditDTO } from '../../domain/repositories/IPsychotherapyRepository';
import { AppointmentStatus, PsychotherapyAppointment } from '../../domain/models/PsychotherapyAppointment';
import { ClinicalNote } from '../../domain/models/ClinicalNote';
import { AvailabilitySlot } from '../../domain/models/AvailabilitySlot';
import { BookingLink } from '../../domain/models/BookingLink';
import { syncMonthlyRecord } from './MonthlyRecordSynchronizer';
import { validateTenantId } from './shared';
import { PostgresTenantProfileRepository } from './PostgresTenantProfileRepository';
import { PostgresGoogleOAuthRepository } from './PostgresGoogleOAuthRepository';
import { PostgresAvailabilitySlotRepository } from './PostgresAvailabilitySlotRepository';

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
    ReceiptRow,
    SessionRow,
    ExpenseRow,
    FixedExpenseRow,
    AppointmentRow,
    ClinicalNoteRow,
    BookingLinkRow
} from './dbRowTypes';

@injectable()
export class PostgresPsychotherapyRepository implements IPsychotherapyRepository {
    private readonly tenantProfileRepository: PostgresTenantProfileRepository;
    private readonly googleOAuthRepository: PostgresGoogleOAuthRepository;
    private readonly availabilitySlotRepository: PostgresAvailabilitySlotRepository;

    constructor(private readonly dbPool: Pool) {
        this.tenantProfileRepository = new PostgresTenantProfileRepository(dbPool);
        this.googleOAuthRepository = new PostgresGoogleOAuthRepository(dbPool);
        this.availabilitySlotRepository = new PostgresAvailabilitySlotRepository(dbPool);
    }

    async savePatient(data: SavePatientDTO): Promise<PsychotherapyPatient> {
        const tenantId = validateTenantId(data.tenantId);
        const result = await this.dbPool.query(`
            INSERT INTO psychotherapy_patients (
                id, tenant_id, name, status, payment_type, default_session_price_cents,
                notes, document, phone, email, reminder_channel, full_name, individual_therapy_enabled
            )
            VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
                individual_therapy_enabled = EXCLUDED.individual_therapy_enabled,
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
            data.fullName ?? null,
            data.individualTherapyEnabled ?? true
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
        const validTenantId = validateTenantId(tenantId);
        if (pagination) {
            const offset = (pagination.page - 1) * pagination.limit;
            const params: unknown[] = [validTenantId, PASTORAL_SENTINEL_EMAIL];
            let whereClause = 'WHERE tenant_id = $1 AND (email IS NULL OR email != $2) AND deleted_at IS NULL';

            if (pagination.search) {
                params.push(`%${pagination.search}%`);
                whereClause += ` AND name ILIKE $${params.length}`;
            } else {
                // Pacientes inativos somem da listagem padrão (mas continuam achável
                // buscando pelo nome, caso precise reativar).
                whereClause += ` AND status != 'inactive'`;
            }

            if (pagination.scope === 'individual') {
                whereClause += ` AND individual_therapy_enabled = TRUE`;
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
            SELECT * FROM psychotherapy_patients
            WHERE tenant_id = $1 AND deleted_at IS NULL
            ORDER BY status = 'inactive', name ASC
        `, [validTenantId]);
        return result.rows.map(row => this.mapPatient(row));
    }

    async listIndividualPatientsForBilling(tenantId: string): Promise<PsychotherapyPatient[]> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT * FROM psychotherapy_patients
            WHERE tenant_id = $1 AND individual_therapy_enabled = TRUE AND deleted_at IS NULL
            ORDER BY status = 'inactive', name ASC
        `, [validTenantId]);
        return result.rows.map(row => this.mapPatient(row));
    }

    async findPatientById(tenantId: string, id: string): Promise<PsychotherapyPatient | null> {
        return this.findActivePatientById(tenantId, id);
    }

    async findActivePatientById(tenantId: string, id: string): Promise<PsychotherapyPatient | null> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT *
            FROM psychotherapy_patients
            WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL;
        `, [validTenantId, id]);

        return result.rows[0] ? this.mapPatient(result.rows[0]) : null;
    }

    async findPatientByIdIncludingDeleted(tenantId: string, id: string): Promise<PsychotherapyPatient | null> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT *
            FROM psychotherapy_patients
            WHERE tenant_id = $1 AND id = $2;
        `, [validTenantId, id]);

        return result.rows[0] ? this.mapPatient(result.rows[0]) : null;
    }

    async deletePatient(tenantId: string, id: string): Promise<void> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            UPDATE psychotherapy_patients
            SET deleted_at = NOW(), updated_at = NOW()
            WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL;
        `, [validTenantId, id]);

        if (result.rowCount === 0) throw new NotFoundError('Paciente não encontrado ou não autorizado');
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
                if (resynced.rows.length > 0) return this.mapMonthlyRecord(resynced.rows[0]);
            }

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

        return this.mapMonthlyRecord(result.rows[0]);
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

        return result.rows.map(row => this.mapMonthlyRecord(row));
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

        return this.mapMonthlyRecord(result.rows[0]);
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

        return result.rows.map(row => this.mapMonthlyRecord(row));
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
            return this.mapReceipt(receipt);
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
        const validTenantId = validateTenantId(tenantId);
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

    async saveSession(data: SaveSessionDTO): Promise<PsychotherapySession> {
        const tenantId = validateTenantId(data.tenantId);
        const client = await this.dbPool.connect();

        try {
            await client.query('BEGIN');

            // Sessão vinculada a um agendamento (appointment_id, migration 082): data/status são
            // gerenciados pelo Agendamento (fonte de verdade da agenda) — o Diário só pode editar
            // notes nela. Checagem + upsert na MESMA transação com FOR UPDATE: sem isso, um
            // saveAppointment() concorrente podia reagendar a sessão entre a checagem e o UPDATE
            // daqui, e este UPDATE sobrescreveria com data/status já obsoletos (achado da 2ª
            // revisão, 04/07/2026). Também rejeita se patientId enviado pelo cliente estiver
            // obsoleto (ex: tela carregada pro paciente A, agendamento foi transferido pra B
            // enquanto isso) — evita gravar nota clínica na sessão errada.
            if (data.id) {
                const existing = await client.query(
                    `SELECT date, status, patient_id, appointment_id FROM psychotherapy_sessions
                     WHERE id = $1 AND tenant_id = $2
                     FOR UPDATE`,
                    [data.id, tenantId]
                );
                if (existing.rows.length === 0) {
                    throw new NotFoundError('Sessão não encontrada ou não autorizada');
                }
                const current = existing.rows[0];

                if (current.patient_id !== data.patientId) {
                    throw new AppError(
                        'Esta sessão pertence a outro paciente agora (dado desatualizado na ' +
                        'tela) — recarregue a página antes de salvar.',
                        409
                    );
                }

                if (current.appointment_id) {
                    const dateChanged = new Date(current.date).getTime() !== new Date(data.date).getTime();
                    const statusChanged = current.status !== data.status;
                    if (dateChanged || statusChanged) {
                        throw new AppError(
                            'Esta sessão está vinculada a um agendamento — data e status só podem ' +
                            'ser alterados pela tela de Agendamentos. Você pode editar as notas aqui.',
                            409
                        );
                    }
                }
            }

            const result = await client.query(`
                INSERT INTO psychotherapy_sessions (
                    id, tenant_id, patient_id, date, status, notes
                )
                VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6)
                ON CONFLICT (id) DO UPDATE SET
                    date = EXCLUDED.date,
                    status = EXCLUDED.status,
                    notes = EXCLUDED.notes,
                    updated_at = NOW()
                WHERE psychotherapy_sessions.tenant_id = EXCLUDED.tenant_id
                RETURNING *;
            `, [
                data.id || null,
                tenantId,
                data.patientId,
                data.date,
                data.status,
                data.notes || null
            ]);

            if (result.rows.length === 0) throw new NotFoundError('Sessão não encontrada ou não autorizada');

            await client.query('COMMIT');
            return this.mapSession(result.rows[0]);
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async listSessions(
        tenantId: string,
        patientId?: string,
        start?: Date,
        end?: Date,
        pagination?: PaginationOptions
    ): Promise<PaginatedResult<PsychotherapySession>> {
        const validTenantId = validateTenantId(tenantId);
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
        const validTenantId = validateTenantId(tenantId);

        // Sessão vinculada a um agendamento: excluir por aqui deixaria o agendamento
        // "attended"/"no_show"/"canceled" sem sessão correspondente. Precisa reverter o status
        // do agendamento (que já cuida de remover a sessão) ou excluir o agendamento.
        const linked = await this.dbPool.query(
            `SELECT appointment_id FROM psychotherapy_sessions WHERE id = $1 AND tenant_id = $2`,
            [id, validTenantId]
        );
        if (linked.rows.length > 0 && linked.rows[0].appointment_id) {
            throw new AppError(
                'Esta sessão está vinculada a um agendamento — para removê-la, reverta o ' +
                'status do agendamento ou exclua o agendamento na tela de Agendamentos.',
                409
            );
        }

        const result = await this.dbPool.query(`
            DELETE FROM psychotherapy_sessions
            WHERE tenant_id = $1 AND id = $2;
        `, [validTenantId, id]);

        if (result.rowCount === 0) throw new NotFoundError('Sessão não encontrada ou não autorizada');
    }

    async saveExpense(data: SaveExpenseDTO): Promise<PsychotherapyExpense> {
        const tenantId = validateTenantId(data.tenantId);
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
            WHERE psychotherapy_expenses.tenant_id = EXCLUDED.tenant_id
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

        if (result.rows.length === 0) throw new NotFoundError('Despesa não encontrada ou não autorizada');
        return this.mapExpense(result.rows[0]);
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
            data: result.rows.map(row => this.mapExpense(row)),
            total
        };
    }

    async deleteExpense(tenantId: string, id: string): Promise<void> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            DELETE FROM psychotherapy_expenses
            WHERE tenant_id = $1 AND id = $2;
        `, [validTenantId, id]);

        if (result.rowCount === 0) throw new NotFoundError('Despesa não encontrada ou não autorizada');
    }

    async listFixedExpenses(tenantId: string): Promise<PsychotherapyFixedExpense[]> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT * FROM psychotherapy_fixed_expenses
            WHERE tenant_id = $1
            ORDER BY day_of_month ASC, created_at DESC;
        `, [validTenantId]);

        return result.rows.map(row => this.mapFixedExpense(row));
    }

    async saveFixedExpense(data: SaveFixedExpenseDTO): Promise<PsychotherapyFixedExpense> {
        const tenantId = validateTenantId(data.tenantId);
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
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            DELETE FROM psychotherapy_fixed_expenses
            WHERE tenant_id = $1 AND id = $2;
        `, [validTenantId, id]);

        if (result.rowCount === 0) {
            throw new NotFoundError('Despesa fixa não encontrada ou não autorizada');
        }
    }

    async toggleFixedExpense(tenantId: string, id: string, active: boolean): Promise<PsychotherapyFixedExpense> {
        const validTenantId = validateTenantId(tenantId);
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
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT 1 FROM psychotherapy_expenses
            WHERE tenant_id = $1 AND fixed_expense_id = $2 AND reference_month = $3
            LIMIT 1;
        `, [validTenantId, fixedExpenseId, month]);

        return result.rows.length > 0;
    }

    private async checkAndInstantiateFixedExpenses(tenantId: string, monthStr: string): Promise<void> {
        const validTenantId = validateTenantId(tenantId);
        const fixedExpenses = await this.listFixedExpenses(validTenantId);

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
                const record = this.mapMonthlyRecord(row);
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

    // ── Appointments ──────────────────────────────────────────────────────────

    async saveAppointment(data: SaveAppointmentDTO): Promise<PsychotherapyAppointment> {
        const tenantId = validateTenantId(data.tenantId);

        const client = await this.dbPool.connect();
        try {
            await client.query('BEGIN');

            // Pré-leitura do agendamento anterior (reagendamento/troca de paciente), com lock —
            // evita corrida com uma exclusão/atualização concorrente do mesmo agendamento
            // (achado na revisão de 04/07/2026).
            let oldMonth: string | null = null;
            let oldPatientId: string | null = null;
            if (data.id) {
                const prev = await client.query(
                    `SELECT scheduled_at, patient_id FROM psychotherapy_appointments
                     WHERE id = $1 AND tenant_id = $2
                     FOR UPDATE`,
                    [data.id, tenantId]
                );
                if (prev.rows[0]) {
                    oldMonth = toMonthStr(new Date(prev.rows[0].scheduled_at));
                    oldPatientId = prev.rows[0].patient_id;
                }
            }

            const patientChanged = oldPatientId !== null && oldPatientId !== data.patientId;
            if (patientChanged) {
                // Reatribuir um agendamento pra outro paciente é uma operação rara e perigosa
                // se já existe conteúdo clínico registrado na sessão vinculada — nesse caso, a
                // troca é bloqueada (o operador deve criar um novo agendamento em vez de
                // reaproveitar este). Ver achado da revisão de 04/07/2026.
                // Conteúdo clínico = nota estruturada (psychotherapy_clinical_notes) OU texto
                // livre em session.notes (achado da 2ª revisão, 04/07/2026: a checagem original
                // só olhava a tabela estruturada, deixando passar session.notes preenchido).
                // Lock PRIMEIRO, checagem de conteúdo DEPOIS em consulta separada (achado da 4ª
                // revisão, 04/07/2026): um SELECT com FOR UPDATE + EXISTS no mesmo statement
                // pode não enxergar uma nota clínica confirmada por outra transação enquanto
                // esperava o lock (o EXISTS usa o snapshot do início do statement, só a própria
                // linha travada é reobtida). Serializa contra saveSession()/saveClinicalNote().
                const lock = await client.query(
                    `SELECT s.id FROM psychotherapy_sessions s
                     WHERE s.tenant_id = $1 AND s.appointment_id = $2
                     FOR UPDATE OF s`,
                    [tenantId, data.id]
                );
                const linkedSession = lock.rows.length === 0 ? { rows: [{}] } : await client.query(
                    `SELECT
                        (NULLIF(TRIM(s.notes), '') IS NOT NULL) AS has_notes,
                        EXISTS (
                            SELECT 1 FROM psychotherapy_clinical_notes cn WHERE cn.session_id = s.id
                        ) AS has_clinical_notes
                     FROM psychotherapy_sessions s
                     WHERE s.id = $1`,
                    [lock.rows[0].id]
                );
                if (linkedSession.rows[0]?.has_notes || linkedSession.rows[0]?.has_clinical_notes) {
                    throw new AppError(
                        'Não é possível trocar o paciente deste agendamento: já existe conteúdo ' +
                        'clínico registrado na sessão vinculada. Crie um novo agendamento.',
                        409
                    );
                }
            }

            const id = data.id || crypto.randomUUID();
            const duration = data.durationMinutes ?? 50;
            const scheduledAt = data.scheduledAt;
            const endedAt = new Date(scheduledAt.getTime() + duration * 60 * 1000);

            // Determinar se é grupo ou individual
            const isGroup = !!data.groupId;
            const eventType = isGroup ? 'group' : 'individual';
            let calendarEventId = data.calendarEventId;
            const eventStatus = (data.status === 'attended' || data.status === 'no_show') ? 'completed' : (data.status ?? 'scheduled');

            if (!calendarEventId) {
                if (isGroup) {
                    // Tenta achar evento do grupo no mesmo horário
                    const existingRes = await client.query(`
                        SELECT id FROM calendar_events
                        WHERE tenant_id = $1 AND group_id = $2 AND scheduled_at = $3;
                    `, [tenantId, data.groupId, scheduledAt]);
                    if (existingRes.rows.length > 0) {
                        calendarEventId = existingRes.rows[0].id;
                    } else {
                        calendarEventId = crypto.randomUUID();
                        await client.query(`
                            INSERT INTO calendar_events (id, tenant_id, scheduled_at, ended_at, duration_minutes, event_type, status, group_id)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
                        `, [calendarEventId, tenantId, scheduledAt, endedAt, duration, eventType, eventStatus, data.groupId]);
                    }
                } else {
                    // Individual usa 1-para-1 correspondência
                    calendarEventId = id;
                    await client.query(`
                        INSERT INTO calendar_events (id, tenant_id, scheduled_at, ended_at, duration_minutes, event_type, status, group_id)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)
                        ON CONFLICT (id) DO UPDATE SET
                            scheduled_at = EXCLUDED.scheduled_at,
                            ended_at = EXCLUDED.ended_at,
                            duration_minutes = EXCLUDED.duration_minutes,
                            status = EXCLUDED.status,
                            updated_at = NOW()
                        WHERE calendar_events.tenant_id = EXCLUDED.tenant_id;
                    `, [calendarEventId, tenantId, scheduledAt, endedAt, duration, eventType, eventStatus]);
                }
            } else {
                // Atualiza o evento correspondente se já existir
                await client.query(`
                    UPDATE calendar_events
                    SET scheduled_at = $1, ended_at = $2, duration_minutes = $3, status = $4, updated_at = NOW()
                    WHERE id = $5 AND tenant_id = $6;
                `, [scheduledAt, endedAt, duration, eventStatus, calendarEventId, tenantId]);
            }

            const result = await client.query(`
                INSERT INTO psychotherapy_appointments (
                    id, tenant_id, patient_id, scheduled_at, duration_minutes,
                    status, recurrence, recurrence_end_date, notes, parent_id,
                    calendar_event_id, group_id
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                ON CONFLICT (id) DO UPDATE SET
                    patient_id = EXCLUDED.patient_id,
                    scheduled_at = EXCLUDED.scheduled_at,
                    duration_minutes = EXCLUDED.duration_minutes,
                    status = EXCLUDED.status,
                    recurrence = EXCLUDED.recurrence,
                    recurrence_end_date = EXCLUDED.recurrence_end_date,
                    notes = EXCLUDED.notes,
                    parent_id = EXCLUDED.parent_id,
                    calendar_event_id = EXCLUDED.calendar_event_id,
                    group_id = EXCLUDED.group_id,
                    updated_at = NOW()
                WHERE psychotherapy_appointments.tenant_id = EXCLUDED.tenant_id
                RETURNING *;
            `, [
                id,
                tenantId,
                data.patientId,
                scheduledAt,
                duration,
                data.status ?? 'scheduled',
                data.recurrence ?? 'none',
                data.recurrenceEndDate ?? null,
                data.notes ?? null,
                data.parentId || null,
                calendarEventId,
                data.groupId || null
            ]);

            if (result.rows.length === 0) {
                throw new NotFoundError('Agendamento não encontrado ou não autorizado');
            }

            // Sincronização com o Diário de Sessões (vínculo por appointment_id, migration 082).
            // saveAppointment() é usado tanto pra criar/editar quanto pelo fluxo de "atendimento
            // retroativo" do frontend (agendamento já criado com status='attended' desde o
            // início) — antes desta correção, só updateAppointmentStatus() sincronizava a
            // sessão, então o fluxo retroativo nunca gerava sessão nenhuma (achado da revisão
            // de 03/07/2026). Mesma lógica de status → session_status usada lá.
            //
            // IMPORTANTE (achado da revisão de 04/07/2026): NÃO copiar appointment.notes pra
            // session.notes. São conteúdos diferentes — notes do agendamento é observação de
            // agenda, notes da sessão é conteúdo clínico (protegido de exclusão em outros
            // pontos deste arquivo). Copiar aqui arriscava sobrescrever silenciosamente uma
            // nota clínica já registrada. notes da sessão só é gerenciado via saveSession()/
            // Diário — nunca por este fluxo.
            const finalStatus = result.rows[0].status;
            if (finalStatus === 'attended' || finalStatus === 'no_show' || finalStatus === 'canceled') {
                const targetSessionStatus =
                    finalStatus === 'attended' ? 'attended' :
                    finalStatus === 'no_show'  ? 'unjustified_absence' : 'canceled';

                await client.query(`
                    INSERT INTO psychotherapy_sessions (id, tenant_id, patient_id, date, status, appointment_id)
                    VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
                    ON CONFLICT (appointment_id) WHERE appointment_id IS NOT NULL DO UPDATE SET
                        patient_id = EXCLUDED.patient_id,
                        date = EXCLUDED.date,
                        status = EXCLUDED.status,
                        updated_at = NOW();
                `, [tenantId, data.patientId, scheduledAt, targetSessionStatus, id]);
            } else {
                // Reverter pra scheduled/confirmed com conteúdo clínico registrado deixaria um
                // estado contraditório (agendamento "scheduled", sessão ainda "attended" com
                // nota) — bloqueado explicitamente em vez de preservar silenciosamente (achado
                // da 2ª revisão, 04/07/2026). Lock primeiro, checagem de conteúdo depois em
                // consulta separada (achado da 4ª revisão, 04/07/2026 — ver comentário
                // equivalente na checagem de troca de paciente acima).
                const lockRev = await client.query(`
                    SELECT s.id FROM psychotherapy_sessions s
                    WHERE s.tenant_id = $1 AND s.appointment_id = $2
                    FOR UPDATE OF s
                `, [tenantId, id]);
                const linkedContent = lockRev.rows.length === 0 ? { rows: [{}] } : await client.query(`
                    SELECT
                        (NULLIF(TRIM(s.notes), '') IS NOT NULL) AS has_notes,
                        EXISTS (
                            SELECT 1 FROM psychotherapy_clinical_notes cn WHERE cn.session_id = s.id
                        ) AS has_clinical_notes
                    FROM psychotherapy_sessions s
                    WHERE s.id = $1
                `, [lockRev.rows[0].id]);

                if (linkedContent.rows[0]?.has_notes || linkedContent.rows[0]?.has_clinical_notes) {
                    throw new AppError(
                        'Não é possível reverter este agendamento: a sessão vinculada tem ' +
                        'conteúdo clínico registrado. Remova o conteúdo clínico antes de reverter.',
                        409
                    );
                }

                await client.query(`
                    DELETE FROM psychotherapy_sessions
                    WHERE tenant_id = $1 AND appointment_id = $2;
                `, [tenantId, id]);
            }

            await client.query('COMMIT');

            const appointment = this.mapAppointment(result.rows[0]);
            const newMonth = toMonthStr(data.scheduledAt);
            await syncMonthlyRecord(this.dbPool, tenantId, data.patientId, newMonth);
            if (oldMonth && oldMonth !== newMonth) {
                // Se o paciente também mudou, o mês antigo pertence ao paciente ANTERIOR, não
                // ao novo (achado da revisão de 04/07/2026).
                await syncMonthlyRecord(this.dbPool, tenantId, oldPatientId ?? data.patientId, oldMonth);
            }
            if (patientChanged && oldPatientId) {
                // Mesmo sem mudança de mês, o registro mensal do paciente anterior no mês
                // atual também precisa ser recalculado (perdeu este agendamento).
                await syncMonthlyRecord(this.dbPool, tenantId, oldPatientId, newMonth);
            }

            return appointment;
        } catch (error: any) {
            await client.query('ROLLBACK');
            if (error.code === '23P01') {
                throw new AppError('Este horário conflita com outro agendamento ativo.', 409);
            }
            throw error;
        } finally {
            client.release();
        }
    }

    async listAppointments(tenantId: string, options: ListAppointmentsOptions = {}): Promise<PaginatedResult<PsychotherapyAppointment>> {
        const validTenantId = validateTenantId(tenantId);
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
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT * FROM psychotherapy_appointments
            WHERE tenant_id = $1 AND id = $2;
        `, [validTenantId, id]);
        return result.rows[0] ? this.mapAppointment(result.rows[0]) : null;
    }

    async deleteAppointment(tenantId: string, id: string): Promise<void> {
        const validTenantId = validateTenantId(tenantId);
        const client = await this.dbPool.connect();

        try {
            await client.query('BEGIN');

            // 1. Lê o agendamento + dados do paciente antes de deletar, com lock — evita
            // corrida com um update/save concorrente do mesmo agendamento (achado na revisão
            // de 04/07/2026: sem FOR UPDATE, uma sessão podia ser recriada entre o DELETE da
            // sessão abaixo e o DELETE do agendamento).
            const appQuery = await client.query(`
                SELECT
                    a.patient_id, a.scheduled_at, a.status,
                    a.calendar_event_id, a.group_id,
                    p.payment_type, p.default_session_price_cents,
                    p.name AS patient_name, p.status AS patient_status
                FROM psychotherapy_appointments a
                JOIN psychotherapy_patients p ON p.id = a.patient_id
                WHERE a.tenant_id = $1 AND a.id = $2
                FOR UPDATE OF a
            `, [validTenantId, id]);

            if (appQuery.rows.length === 0)
                throw new NotFoundError('Agendamento não encontrado ou não autorizado');

            const { patient_id, scheduled_at, status, payment_type, calendar_event_id, group_id } = appQuery.rows[0];

            // 3. Remove sessão correspondente (somente se sem notas clínicas). Vínculo por
            // appointment_id (FK composta, migration 082) — ver nota em updateAppointmentStatus.
            await client.query(`
                DELETE FROM psychotherapy_sessions
                WHERE tenant_id = $1 AND appointment_id = $2
                  AND (notes IS NULL OR TRIM(notes) = '')
                  AND NOT EXISTS (
                      SELECT 1 FROM psychotherapy_clinical_notes
                      WHERE session_id = psychotherapy_sessions.id
                  )
            `, [validTenantId, id]);

            // 3b. Sessões PRESERVADAS (com nota clínica) precisam ter o vínculo desfeito antes
            // de excluir o agendamento — a FK (appointment_id, tenant_id) não tem ON DELETE
            // SET NULL (evitar zerar tenant_id, que é NOT NULL, numa FK composta), então sem
            // isso o DELETE do agendamento abaixo violaria a FK.
            await client.query(`
                UPDATE psychotherapy_sessions
                SET appointment_id = NULL, updated_at = NOW()
                WHERE tenant_id = $1 AND appointment_id = $2
            `, [validTenantId, id]);

            // 4. Deleta o agendamento
            const del = await client.query(`
                DELETE FROM psychotherapy_appointments
                WHERE tenant_id = $1 AND id = $2
            `, [validTenantId, id]);

            if (del.rowCount === 0)
                throw new NotFoundError('Agendamento não encontrado ou não autorizado');

            // 5. Remove calendar_event associado se for individual
            if (calendar_event_id && !group_id) {
                await client.query(`
                    DELETE FROM calendar_events
                    WHERE id = $1 AND tenant_id = $2
                `, [calendar_event_id, validTenantId]);
            }

            await syncMonthlyRecord(
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
        const validTenantId = validateTenantId(tenantId);
        const client = await this.dbPool.connect();

        try {
            await client.query('BEGIN');

            // ── Pré-leitura: old_status + dados do paciente (com lock, ver deleteAppointment) ──
            const preQuery = await client.query(`
                SELECT
                    a.patient_id, a.scheduled_at, a.status AS old_status,
                    a.calendar_event_id, a.group_id,
                    p.name   AS patient_name,
                    p.status AS patient_status,
                    p.payment_type,
                    p.default_session_price_cents
                FROM psychotherapy_appointments a
                JOIN psychotherapy_patients p ON p.id = a.patient_id
                WHERE a.tenant_id = $1 AND a.id = $2
                FOR UPDATE OF a
            `, [validTenantId, id]);

            if (preQuery.rows.length === 0)
                throw new NotFoundError('Agendamento não encontrado ou não autorizado');

            const {
                patient_id, scheduled_at,
                old_status,
                patient_name, patient_status,
                payment_type, default_session_price_cents,
                calendar_event_id, group_id
            } = preQuery.rows[0];

            // ── 1. Atualiza status ────────────────────────────────────────────
            const result = await client.query(`
                UPDATE psychotherapy_appointments
                SET status = $1, updated_at = NOW()
                WHERE tenant_id = $2 AND id = $3
                RETURNING *;
            `, [status, validTenantId, id]);

            const appointment = result.rows[0];

            // ── 1.1 Atualiza status do calendar_event correspondente se for individual
            if (calendar_event_id && !group_id) {
                const targetEventStatus = (status === 'attended' || status === 'no_show') ? 'completed' : status;
                await client.query(`
                    UPDATE calendar_events
                    SET status = $1, updated_at = NOW()
                    WHERE id = $2 AND tenant_id = $3;
                `, [targetEventStatus, calendar_event_id, validTenantId]);
            }

            // ── 2. Sincronização com o Diário de Sessões ──────────────────────
            // Vínculo por appointment_id (FK, migration 082) — não mais por
            // (tenant_id, patient_id, date). O heurístico por data quebrava em reagendamentos
            // (a sessão ficava órfã na data antiga) e não cobria edições feitas via
            // saveAppointment(). Ver achado da revisão de 03/07/2026.
            if (status === 'attended' || status === 'no_show' || status === 'canceled') {
                const targetSessionStatus =
                    status === 'attended'  ? 'attended' :
                    status === 'no_show'   ? 'unjustified_absence' : 'canceled';

                const sessionCheck = await client.query(`
                    SELECT id FROM psychotherapy_sessions
                    WHERE tenant_id = $1 AND appointment_id = $2
                    LIMIT 1;
                `, [validTenantId, id]);

                // IMPORTANTE (achado da revisão de 04/07/2026): não copiar appointment.notes
                // pra session.notes — são conteúdos diferentes, e sobrescreveria uma nota
                // clínica já registrada. notes da sessão só é gerenciado via saveSession().
                if (sessionCheck.rows.length > 0) {
                    await client.query(`
                        UPDATE psychotherapy_sessions
                        SET status = $1, date = $2, updated_at = NOW()
                        WHERE id = $3;
                    `, [targetSessionStatus, scheduled_at, sessionCheck.rows[0].id]);
                } else {
                    await client.query(`
                        INSERT INTO psychotherapy_sessions (id, tenant_id, patient_id, date, status, appointment_id)
                        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5);
                    `, [validTenantId, patient_id, scheduled_at, targetSessionStatus, id]);
                }
            } else if (status === 'scheduled' || status === 'confirmed') {
                // Mesma regra de saveAppointment(): bloquear em vez de preservar silenciosamente
                // um estado contraditório (achado da 2ª revisão, 04/07/2026). Lock primeiro,
                // checagem depois em consulta separada (achado da 4ª revisão, 04/07/2026).
                const lockRev2 = await client.query(`
                    SELECT s.id FROM psychotherapy_sessions s
                    WHERE s.tenant_id = $1 AND s.appointment_id = $2
                    FOR UPDATE OF s
                `, [validTenantId, id]);
                const linkedContent = lockRev2.rows.length === 0 ? { rows: [{}] } : await client.query(`
                    SELECT
                        (NULLIF(TRIM(s.notes), '') IS NOT NULL) AS has_notes,
                        EXISTS (
                            SELECT 1 FROM psychotherapy_clinical_notes cn WHERE cn.session_id = s.id
                        ) AS has_clinical_notes
                    FROM psychotherapy_sessions s
                    WHERE s.id = $1
                `, [lockRev2.rows[0].id]);

                if (linkedContent.rows[0]?.has_notes || linkedContent.rows[0]?.has_clinical_notes) {
                    throw new AppError(
                        'Não é possível reverter este agendamento: a sessão vinculada tem ' +
                        'conteúdo clínico registrado. Remova o conteúdo clínico antes de reverter.',
                        409
                    );
                }

                await client.query(`
                    DELETE FROM psychotherapy_sessions
                    WHERE tenant_id = $1 AND appointment_id = $2;
                `, [validTenantId, id]);
            }

            await syncMonthlyRecord(
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
                a.duration_minutes,
                t.whatsapp_reminder_template
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
            whatsappReminderTemplate: row.whatsapp_reminder_template ?? null,
        }));
    }

    async findFailedWhatsappReminders(now: Date, windowStart: Date, maxAttempts: number): Promise<UpcomingAppointment[]> {
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
                a.duration_minutes,
                t.whatsapp_reminder_template
            FROM psychotherapy_appointments a
            JOIN psychotherapy_patients p ON p.id = a.patient_id
            JOIN tenants t ON t.id = a.tenant_id
            WHERE a.scheduled_at > $1
              AND a.scheduled_at < $2
              AND a.status IN ('scheduled', 'confirmed')
              AND p.reminder_channel IN ('whatsapp', 'both')
              AND EXISTS (
                  SELECT 1 FROM psychotherapy_reminders_log rl
                  WHERE rl.appointment_id = a.id AND rl.channel_used = 'whatsapp' AND rl.status = 'failed'
              )
              AND NOT EXISTS (
                  SELECT 1 FROM psychotherapy_reminders_log rl2
                  WHERE rl2.appointment_id = a.id AND rl2.channel_used = 'whatsapp' AND rl2.status = 'success'
              )
              AND (
                  SELECT COUNT(*) FROM psychotherapy_reminders_log rl3
                  WHERE rl3.appointment_id = a.id AND rl3.channel_used = 'whatsapp' AND rl3.status = 'failed'
              ) < $3
              -- A TENTATIVA MAIS RECENTE (não "alguma") precisa ser elegível para retry —
              -- se o último resultado foi ambíguo (timeout/5xx da Cloud API), a mensagem pode já
              -- ter sido entregue, então não reenviamos automaticamente mesmo que uma tentativa
              -- anterior tenha sido uma rejeição comum e elegível.
              AND COALESCE((
                  SELECT rl4.retry_eligible FROM psychotherapy_reminders_log rl4
                  WHERE rl4.appointment_id = a.id AND rl4.channel_used = 'whatsapp'
                  ORDER BY rl4.sent_at DESC, rl4.id DESC LIMIT 1
              ), TRUE) = TRUE
            ORDER BY a.scheduled_at ASC;
        `, [now, windowStart, maxAttempts]);

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
            whatsappReminderTemplate: row.whatsapp_reminder_template ?? null,
        }));
    }

    async markReminderSent(
        appointmentId: string,
        tenantId: string,
        channelUsed: 'whatsapp' | 'email',
        status: 'success' | 'failed',
        errorMessage?: string,
        options?: MarkReminderSentOptions
    ): Promise<void> {
        await this.dbPool.query(`
            INSERT INTO psychotherapy_reminders_log
                (tenant_id, appointment_id, channel_used, status, error_message, provider, retry_eligible)
            VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, TRUE));
        `, [
            tenantId, appointmentId, channelUsed, status, errorMessage ?? null,
            options?.provider ?? null,
            options?.retryEligible,
        ]);
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
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT * FROM psychotherapy_appointments
            WHERE tenant_id = $1 AND google_event_id = $2;
        `, [validTenantId, googleEventId]);
        return result.rows[0] ? this.mapAppointment(result.rows[0]) : null;
    }

    async updateAppointmentGoogleEvent(id: string, tenantId: string, googleEventId: string, googleEventUrl: string): Promise<void> {
        const validTenantId = validateTenantId(tenantId);
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
        const tenantId = validateTenantId(data.tenantId);
        const client = await this.dbPool.connect();

        try {
            await client.query('BEGIN');

            // Trava a sessão vinculada (se houver) ANTES de inserir a nota — sem isso, um
            // fluxo de appointment concorrente (troca de paciente/reversão) podia ler a sessão
            // como "sem conteúdo clínico" no meio do INSERT desta nota e prosseguir (achado da
            // 4ª revisão, 04/07/2026). Serializa contra o FOR UPDATE OF s usado nos 3 pontos de
            // saveAppointment()/updateAppointmentStatus() e em saveSession().
            if (data.sessionId) {
                const session = await client.query(
                    `SELECT patient_id FROM psychotherapy_sessions
                     WHERE id = $1 AND tenant_id = $2
                     FOR UPDATE`,
                    [data.sessionId, tenantId]
                );
                if (session.rows.length === 0) {
                    throw new NotFoundError('Sessão vinculada não encontrada ou não autorizada');
                }
                if (session.rows[0].patient_id !== data.patientId) {
                    throw new AppError(
                        'Esta sessão pertence a outro paciente agora (dado desatualizado na ' +
                        'tela) — recarregue a página antes de salvar.',
                        409
                    );
                }
            }

            const result = await client.query(`
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

            await client.query('COMMIT');
            return this.mapClinicalNote(result.rows[0]);
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async listClinicalNotes(tenantId: string, patientId: string, page = 1, limit = 20): Promise<PaginatedResult<ClinicalNote>> {
        const validTenantId = validateTenantId(tenantId);
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
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT * FROM psychotherapy_clinical_notes
            WHERE tenant_id = $1 AND id = $2;
        `, [validTenantId, id]);
        return result.rows[0] ? this.mapClinicalNote(result.rows[0]) : null;
    }

    async deleteClinicalNote(tenantId: string, id: string): Promise<void> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            DELETE FROM psychotherapy_clinical_notes
            WHERE tenant_id = $1 AND id = $2;
        `, [validTenantId, id]);
        if (result.rowCount === 0) throw new NotFoundError('Nota clínica não encontrada ou não autorizada');
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
        const validTenantId = validateTenantId(tenantId);
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
        const validTenantId = validateTenantId(tenantId);
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
        const validTenantId = validateTenantId(tenantId);
        await this.dbPool.query(`
            UPDATE psychotherapy_booking_links SET is_active = FALSE, updated_at = NOW()
            WHERE tenant_id = $1 AND patient_id = $2;
        `, [validTenantId, patientId]);
    }

    // ── Public booking tokens ─────────────────────────────────────────────────

    async getOrCreatePublicBookingToken(tenantId: string): Promise<string> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            INSERT INTO psychotherapy_public_booking_tokens (tenant_id)
            VALUES ($1)
            ON CONFLICT (tenant_id) DO UPDATE SET
                is_active  = TRUE,
                updated_at = NOW()
            RETURNING token::text
        `, [validTenantId]);
        return result.rows[0].token;
    }

    async findPublicBookingToken(token: string): Promise<string | null> {
        const result = await this.dbPool.query(`
            SELECT tenant_id FROM psychotherapy_public_booking_tokens
            WHERE token = $1::uuid AND is_active = TRUE
        `, [token]);
        return result.rows[0]?.tenant_id ?? null;
    }

    async findPatientByPhone(tenantId: string, phone: string): Promise<PsychotherapyPatient | null> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT * FROM psychotherapy_patients
            WHERE tenant_id = $1 AND phone = $2
            LIMIT 1
        `, [validTenantId, phone]);
        return result.rows[0] ? this.mapPatient(result.rows[0]) : null;
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
            row.full_name ?? null,
            row.whatsapp_bulk_opt_in ?? false,
            row.individual_therapy_enabled
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
            new Date(row.updated_at),
            row.patient_name_snapshot,
            row.patient_document_snapshot,
            row.tenant_name_snapshot,
            row.tenant_document_snapshot,
            row.tenant_professional_id_snapshot,
            row.tenant_address_snapshot,
            row.status
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
            appointmentId: row.appointment_id ?? undefined,
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
            new Date(row.updated_at),
            row.group_id ?? null
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
}
