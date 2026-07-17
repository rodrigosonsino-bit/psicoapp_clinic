import { Pool } from 'pg';
import { PsychotherapyPatient } from '../../domain/models/PsychotherapyPatient';
import { PASTORAL_SENTINEL_EMAIL } from '../../domain/constants/pastoral';
import { NotFoundError } from '../../domain/errors/NotFoundError';
import { PaginationOptions, SavePatientDTO } from '../../domain/repositories/IPsychotherapyRepository';
import { validateTenantId, mapPatient } from './shared';

/**
 * Extraído de PostgresPsychotherapyRepository, preservando exatamente a lógica original.
 * `savePatient` é COMPLEXO — grava psychotherapy_patients e propaga snapshot pra
 * psychotherapy_monthly_records (2ª query separada, sem transação envolvendo as duas). Ver
 * .claude/plans/pendencias-tecnicas-pos-quitacao-2026-07.md (item 1) e
 * .claude/plans/classificacao-postgres-psychotherapy-repository.md.
 */
export class PostgresPatientRepository {
    constructor(private readonly dbPool: Pool) {}

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

        return mapPatient(result.rows[0]);
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
                data: result.rows.map(row => mapPatient(row)),
                total
            };
        }

        const result = await this.dbPool.query(`
            SELECT * FROM psychotherapy_patients
            WHERE tenant_id = $1 AND deleted_at IS NULL
            ORDER BY status = 'inactive', name ASC
        `, [validTenantId]);
        return result.rows.map(row => mapPatient(row));
    }

    async listIndividualPatientsForBilling(tenantId: string): Promise<PsychotherapyPatient[]> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT * FROM psychotherapy_patients
            WHERE tenant_id = $1 AND individual_therapy_enabled = TRUE AND deleted_at IS NULL
            ORDER BY status = 'inactive', name ASC
        `, [validTenantId]);
        return result.rows.map(row => mapPatient(row));
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

        return result.rows[0] ? mapPatient(result.rows[0]) : null;
    }

    async findPatientByIdIncludingDeleted(tenantId: string, id: string): Promise<PsychotherapyPatient | null> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT *
            FROM psychotherapy_patients
            WHERE tenant_id = $1 AND id = $2;
        `, [validTenantId, id]);

        return result.rows[0] ? mapPatient(result.rows[0]) : null;
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

    async findPatientByPhone(tenantId: string, phone: string): Promise<PsychotherapyPatient | null> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT * FROM psychotherapy_patients
            WHERE tenant_id = $1 AND phone = $2 AND deleted_at IS NULL
            LIMIT 1
        `, [validTenantId, phone]);
        return result.rows[0] ? mapPatient(result.rows[0]) : null;
    }
}
