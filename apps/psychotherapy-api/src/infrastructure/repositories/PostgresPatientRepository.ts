import { Pool } from 'pg';
import { PsychotherapyPatient } from '../../domain/models/PsychotherapyPatient';
import { PASTORAL_SENTINEL_EMAIL } from '../../domain/constants/pastoral';
import { NotFoundError } from '../../domain/errors/NotFoundError';
import { PaginationOptions } from '../../domain/repositories/IPsychotherapyRepository';
import { validateTenantId, mapPatient } from './shared';

/**
 * Extraído de PostgresPsychotherapyRepository (7 métodos de Patients classificados como FOLHA
 * — sem transação, sem side effect cross-domain) sem alterar nenhuma linha de lógica.
 * `savePatient` permanece no arquivo principal (COMPLEXO — propaga snapshot pra
 * psychotherapy_monthly_records). Ver
 * .claude/plans/pendencias-tecnicas-pos-quitacao-2026-07.md (item 1) e
 * .claude/plans/classificacao-postgres-psychotherapy-repository.md.
 */
export class PostgresPatientRepository {
    constructor(private readonly dbPool: Pool) {}

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
            WHERE tenant_id = $1 AND phone = $2
            LIMIT 1
        `, [validTenantId, phone]);
        return result.rows[0] ? mapPatient(result.rows[0]) : null;
    }
}
