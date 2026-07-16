import { Pool } from 'pg';
import { PsychotherapySession } from '../../domain/models/PsychotherapySession';
import { ClinicalNote } from '../../domain/models/ClinicalNote';
import { NotFoundError } from '../../domain/errors/NotFoundError';
import { PaginationOptions, PaginatedResult } from '../../domain/repositories/IPsychotherapyRepository';
import { validateTenantId, mapSession, mapClinicalNote } from './shared';

/**
 * Extraído de PostgresPsychotherapyRepository (métodos de Sessions/Diário clínico
 * classificados como FOLHA — sem transação, sem invariante de concorrência) sem alterar
 * nenhuma linha de lógica. `saveSession`, `deleteSession` e `saveClinicalNote` permanecem no
 * arquivo principal (COMPLEXOS — transação própria com `FOR UPDATE` e invariantes contra
 * `saveAppointment`/`updateAppointmentStatus`). Ver
 * .claude/plans/pendencias-tecnicas-pos-quitacao-2026-07.md (item 1) e
 * .claude/plans/classificacao-postgres-psychotherapy-repository.md.
 */
export class PostgresSessionRepository {
    constructor(private readonly dbPool: Pool) {}

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
            data: result.rows.map(row => mapSession(row)),
            total
        };
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
            data: result.rows.map(row => mapClinicalNote(row)),
            total
        };
    }

    async findClinicalNoteById(tenantId: string, id: string): Promise<ClinicalNote | null> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT * FROM psychotherapy_clinical_notes
            WHERE tenant_id = $1 AND id = $2;
        `, [validTenantId, id]);
        return result.rows[0] ? mapClinicalNote(result.rows[0]) : null;
    }

    async deleteClinicalNote(tenantId: string, id: string): Promise<void> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            DELETE FROM psychotherapy_clinical_notes
            WHERE tenant_id = $1 AND id = $2;
        `, [validTenantId, id]);
        if (result.rowCount === 0) throw new NotFoundError('Nota clínica não encontrada ou não autorizada');
    }
}
