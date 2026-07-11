import { injectable, inject } from 'tsyringe';
import { Pool } from 'pg';
import { AppError } from '../../domain/errors/AppError';
import { logger } from '../../infrastructure/logger';

export interface AttachExistingGroupMemberInput {
    tenantId: string;
    groupId: string;
    patientId: string;
}

export interface AttachExistingGroupMemberResult {
    groupMemberId: string;
    isReactivation: boolean;
}

@injectable()
export class AttachExistingGroupMemberUseCase {
    constructor(@inject(Pool) private readonly dbPool: Pool) {}

    async execute(input: AttachExistingGroupMemberInput): Promise<AttachExistingGroupMemberResult> {
        const { tenantId, groupId, patientId } = input;

        if (!tenantId || !groupId || !patientId) {
            throw new AppError('tenantId, groupId e patientId são obrigatórios.', 400);
        }

        const client = await this.dbPool.connect();

        try {
            await client.query('BEGIN');

            // 1. Check if patient exists and belongs to tenant
            const patientResult = await client.query(`
                SELECT id FROM psychotherapy_patients
                WHERE id = $1 AND tenant_id = $2
            `, [patientId, tenantId]);

            if (patientResult.rows.length === 0) {
                throw new AppError('Paciente não encontrado.', 404);
            }

            // 2. Check if group exists
            const groupResult = await client.query(`
                SELECT id FROM therapy_groups
                WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
            `, [groupId, tenantId]);

            if (groupResult.rows.length === 0) {
                throw new AppError('Grupo não encontrado.', 404);
            }

            // 3. Check for active enrollment (cycle)
            const activeMemberResult = await client.query(`
                SELECT id FROM therapy_group_members
                WHERE tenant_id = $1 AND group_id = $2 AND patient_id = $3 AND left_at IS NULL
                FOR UPDATE
            `, [tenantId, groupId, patientId]);

            if (activeMemberResult.rows.length > 0) {
                // Already active, just return the current cycle
                await client.query('ROLLBACK');
                return { groupMemberId: activeMemberResult.rows[0].id, isReactivation: false };
            }

            // 4. Check if they were a previous member (reactivation)
            const previousMemberResult = await client.query(`
                SELECT id FROM therapy_group_members
                WHERE tenant_id = $1 AND group_id = $2 AND patient_id = $3 AND left_at IS NOT NULL
                LIMIT 1
            `, [tenantId, groupId, patientId]);

            const isReactivation = previousMemberResult.rows.length > 0;

            // 5. Insert new cycle
            const insertResult = await client.query(`
                INSERT INTO therapy_group_members (
                    id, tenant_id, group_id, patient_id, joined_at
                ) VALUES (
                    gen_random_uuid(), $1, $2, $3, CURRENT_DATE
                ) RETURNING id
            `, [tenantId, groupId, patientId]);

            const newGroupMemberId = insertResult.rows[0].id;

            // 6. Create default billing policy for this cycle
            await client.query(`
                INSERT INTO therapy_group_member_billing_policies (
                    id, tenant_id, group_id, patient_id, member_id, 
                    billing_type, valid_from, approved_by, status
                ) VALUES (
                    gen_random_uuid(), $1, $2, $3, $4, 
                    'group_default', CURRENT_DATE, $3, 'active'
                )
            `, [tenantId, groupId, patientId, newGroupMemberId]);

            await client.query('COMMIT');

            logger.info(
                { tenantId, groupId, patientId, groupMemberId: newGroupMemberId },
                'Membro anexado ao grupo com sucesso (novo ciclo).'
            );

            return { groupMemberId: newGroupMemberId, isReactivation };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}
