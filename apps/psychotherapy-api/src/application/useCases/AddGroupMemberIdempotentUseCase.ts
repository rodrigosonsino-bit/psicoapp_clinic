import { injectable, inject } from 'tsyringe';
import { Pool } from 'pg';
import { createHash } from 'crypto';
import { AppError } from '../../domain/errors/AppError';
import { logger } from '../../infrastructure/logger';

export interface AddGroupMemberIdempotentInput {
    tenantId: string;
    groupId: string;
    requestId: string; // UUID v4 do frontend; usado diretamente como idempotency_key
    name: string;
    phone?: string;
    document?: string;
    email?: string;
}

export interface AddGroupMemberIdempotentResult {
    patientId: string;
    isNewPatient: boolean;
}

/**
 * Hash SHA-256 determinístico do payload para detectar reuso do requestId com dados diferentes.
 */
function hashPayload(input: {
    groupId: string;
    name: string;
    phone?: string;
    document?: string;
    email?: string;
}): string {
    const canonical = JSON.stringify({
        groupId:  input.groupId,
        name:     input.name?.trim(),
        phone:    input.phone    ?? null,
        document: input.document ?? null,
        email:    input.email    ?? null,
    });
    return createHash('sha256').update(canonical).digest('hex');
}

@injectable()
export class AddGroupMemberIdempotentUseCase {
    constructor(@inject(Pool) private readonly dbPool: Pool) {}

    async execute(input: AddGroupMemberIdempotentInput): Promise<AddGroupMemberIdempotentResult> {
        const { tenantId, groupId, requestId, name, phone, document, email } = input;

        if (!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
            throw new AppError('requestId é obrigatório e deve ser um UUID válido.', 400);
        }
        if (!name || name.trim().length === 0) {
            throw new AppError('O nome do paciente é obrigatório.', 400);
        }

        const requestHash = hashPayload({ groupId, name, phone, document, email });
        const client = await this.dbPool.connect();

        try {
            await client.query('BEGIN');

            // ── 1. Verificar que o grupo existe ──────────────────────────────────
            const groupResult = await client.query(`
                SELECT id FROM therapy_groups
                WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
                FOR SHARE
            `, [groupId, tenantId]);

            if (groupResult.rows.length === 0) {
                throw new AppError('Grupo não encontrado.', 404);
            }

            // ── 2. Reservar a chave de idempotência atomicamente ─────────────────
            // Usa a PK existente (tenant_id, operation, idempotency_key).
            // requestId é armazenado diretamente em idempotency_key — sem coluna extra.
            // ON CONFLICT DO NOTHING garante que duas requisições concorrentes não criam
            // dois pacientes: apenas a primeira "vence" a reserva.
            const reserve = await client.query(`
                INSERT INTO group_member_creation_requests
                    (tenant_id, operation, idempotency_key, request_hash, group_id)
                VALUES
                    ($1, 'add_member', $2, $3, $4)
                ON CONFLICT (tenant_id, operation, idempotency_key)
                DO NOTHING
                RETURNING request_hash, patient_id
            `, [tenantId, requestId, requestHash, groupId]);

            let record: { request_hash: string; patient_id: string | null } | null = null;

            if (reserve.rows.length > 0) {
                // Esta requisição ganhou a reserva
                record = reserve.rows[0];
            } else {
                // Conflito: outra requisição já reservou este requestId
                const read = await client.query(`
                    SELECT request_hash, patient_id
                    FROM group_member_creation_requests
                    WHERE tenant_id       = $1
                      AND operation       = 'add_member'
                      AND idempotency_key = $2
                    FOR SHARE
                `, [tenantId, requestId]);

                record = read.rows[0] ?? null;
            }

            if (!record) {
                throw new AppError('Falha interna de idempotência: não foi possível reservar ou ler a chave.', 500);
            }

            // ── 3. Validar que o payload não mudou ───────────────────────────────
            if (record.request_hash !== requestHash) {
                throw new AppError(
                    'O requestId foi reutilizado com dados diferentes. Use um novo requestId.',
                    409
                );
            }

            // ── 4. Se patient_id já foi preenchido, retornar resultado idempotente ─
            if (record.patient_id) {
                await client.query('COMMIT');
                return { patientId: record.patient_id, isNewPatient: false };
            }

            // ── 5. Criar o paciente ──────────────────────────────────────────────
            // individual_therapy_enabled = false: não aparece no faturamento individual.
            // payment_type = 'per_session': atende à constraint existente.
            // status = 'inactive': excluído do faturamento individual.
            const insertPatientResult = await client.query(`
                INSERT INTO psychotherapy_patients (
                    id, tenant_id, name, full_name, phone, document, email,
                    status, payment_type, default_session_price_cents,
                    individual_therapy_enabled
                ) VALUES (
                    gen_random_uuid(), $1, $2, $2, $3, $4, $5,
                    'inactive', 'per_session', 0,
                    false
                ) RETURNING id
            `, [
                tenantId,
                name.trim(),
                phone    ?? null,
                document ?? null,
                email    ?? null,
            ]);

            const newPatientId: string = insertPatientResult.rows[0].id;

            // ── 6. Vincular ao grupo ─────────────────────────────────────────────
            await client.query(`
                INSERT INTO therapy_group_members (group_id, patient_id, tenant_id)
                VALUES ($1, $2, $3)
                ON CONFLICT DO NOTHING
            `, [groupId, newPatientId, tenantId]);

            // ── 7. Atualizar a reserva com o patient_id criado ───────────────────
            // Se esta operação falhar, o próximo retry encontrará patient_id = NULL
            // e tentará criar o paciente novamente (protegido pelo UNIQUE de document/phone se aplicável).
            await client.query(`
                UPDATE group_member_creation_requests
                SET patient_id = $1
                WHERE tenant_id       = $2
                  AND operation       = 'add_member'
                  AND idempotency_key = $3
            `, [newPatientId, tenantId, requestId]);

            await client.query('COMMIT');

            logger.info(
                { tenantId, groupId, patientId: newPatientId, requestId },
                'Membro de grupo criado via idempotência.'
            );

            return { patientId: newPatientId, isNewPatient: true };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}
