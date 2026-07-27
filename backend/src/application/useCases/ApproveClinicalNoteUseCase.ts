import { injectable, inject } from 'tsyringe';
import { Pool } from 'pg';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';
import { AppError } from '../../domain/errors/AppError';
import { NotFoundError } from '../../domain/errors/NotFoundError';
import { ClinicalNote } from '../../domain/models/ClinicalNote';

interface ApproveNoteDTO {
    tenantId: string;
    noteId: string;
    content: string;
    version: number;
}

@injectable()
export class ApproveClinicalNoteUseCase {
    constructor(
        @inject(Pool) private readonly dbPool: Pool,
        @inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository
    ) {}

    async execute(data: ApproveNoteDTO): Promise<ClinicalNote> {
        const client = await this.dbPool.connect();
        try {
            await client.query('BEGIN');

            const result = await client.query(
                `UPDATE psychotherapy_clinical_notes
                 SET status = 'final',
                     content = $1,
                     version = version + 1,
                     updated_at = NOW()
                 WHERE id = $2 AND tenant_id = $3 AND status = 'draft' AND version = $4
                 RETURNING id, tenant_id, patient_id, session_id, note_date, content, tags, status, source, version, created_at, updated_at`,
                [data.content, data.noteId, data.tenantId, data.version]
            );

            if (result.rows.length === 0) {
                // Checar se a nota existe, para decidir entre NotFound ou Conflict
                const check = await client.query(
                    `SELECT status, version FROM psychotherapy_clinical_notes WHERE id = $1 AND tenant_id = $2`,
                    [data.noteId, data.tenantId]
                );

                if (check.rows.length === 0) {
                    throw new NotFoundError('Nota clínica não encontrada.');
                }
                const current = check.rows[0];
                if (current.status !== 'draft') {
                    throw new AppError('Nota clínica já foi aprovada.', 400);
                }
                if (current.version !== data.version) {
                    throw new AppError('Conflito de versão. A nota foi modificada por outro processo.', 409);
                }
                throw new AppError('Falha ao aprovar nota.', 500);
            }

            await client.query('COMMIT');
            
            const row = result.rows[0];
            return new ClinicalNote(
                row.id,
                row.tenant_id,
                row.patient_id,
                row.session_id,
                row.note_date,
                row.content,
                row.tags,
                row.created_at,
                row.updated_at,
                row.status,
                row.source,
                row.version
            );
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }
}
