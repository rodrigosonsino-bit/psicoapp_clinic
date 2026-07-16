import { Pool } from 'pg';
import { PsychotherapySession } from '../../domain/models/PsychotherapySession';
import { ClinicalNote } from '../../domain/models/ClinicalNote';
import { NotFoundError } from '../../domain/errors/NotFoundError';
import { AppError } from '../../domain/errors/AppError';
import { PaginationOptions, PaginatedResult, SaveSessionDTO } from '../../domain/repositories/IPsychotherapyRepository';
import { validateTenantId, mapSession, mapClinicalNote } from './shared';

/**
 * Extraído de PostgresPsychotherapyRepository. `saveClinicalNote` permanece no arquivo
 * principal (COMPLEXO — transação própria com `FOR UPDATE` e invariantes contra
 * `saveAppointment`/`updateAppointmentStatus`). `saveSession` e `deleteSession` foram
 * migrados aqui preservando exatamente a transação/invariantes originais. Ver
 * .claude/plans/pendencias-tecnicas-pos-quitacao-2026-07.md (item 1) e
 * .claude/plans/classificacao-postgres-psychotherapy-repository.md.
 */
export class PostgresSessionRepository {
    constructor(private readonly dbPool: Pool) {}

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
            return mapSession(result.rows[0]);
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
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
