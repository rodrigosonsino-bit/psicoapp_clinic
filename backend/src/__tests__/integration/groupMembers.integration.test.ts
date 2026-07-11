/**
 * groupMembers.integration.test.ts
 *
 * Testes de integração para AddGroupMemberIdempotentUseCase.
 * Valida a reserva atômica via requestId (na PK idempotency_key),
 * concorrência sem duplicação de pacientes, e configuração correta
 * (status inactive, individual_therapy_enabled = false).
 *
 * Cenários do plano: #16
 */

import 'reflect-metadata';
import { Pool } from 'pg';
import { getTestPool, teardownTestDb, truncateTables } from './helpers/testDb';
import { createTenant, createGroup } from './helpers/fixtures';
import { AddGroupMemberIdempotentUseCase } from '../../application/useCases/AddGroupMemberIdempotentUseCase';
import { randomUUID as uuidv4 } from 'node:crypto';

jest.setTimeout(120_000);

const TABLES = [
    'group_member_creation_requests', 'therapy_group_members',
    'therapy_groups', 'psychotherapy_patients', 'tenants',
];

let pool: Pool;
let addMemberUseCase: AddGroupMemberIdempotentUseCase;

beforeAll(async () => {
    pool = await getTestPool();
    addMemberUseCase = new AddGroupMemberIdempotentUseCase(pool);
});

afterAll(async () => {
    await teardownTestDb();
});

afterEach(async () => {
    await truncateTables(pool, TABLES);
});

describe('AddGroupMemberIdempotentUseCase', () => {
    it('#16 — cria paciente configurado corretamente para grupo (não polui faturamento individual)', async () => {
        const tenant = await createTenant(pool);
        const group  = await createGroup(pool, tenant.id);
        const requestId = uuidv4();

        const result = await addMemberUseCase.execute({
            tenantId: tenant.id,
            groupId: group.id,
            requestId,
            name: 'Paciente Grupo',
        });

        expect(result.patientId).toBeDefined();
        expect(result.isNewPatient).toBe(true);

        // Verifica o paciente
        const patientRow = await pool.query(
            `SELECT status, payment_type, individual_therapy_enabled FROM psychotherapy_patients WHERE id = $1`,
            [result.patientId]
        );
        expect(patientRow.rows).toHaveLength(1);
        expect(patientRow.rows[0].status).toBe('inactive');
        expect(patientRow.rows[0].payment_type).toBe('per_session');
        expect(patientRow.rows[0].individual_therapy_enabled).toBe(false);

        // Verifica a reserva
        const requestRow = await pool.query(
            `SELECT patient_id FROM group_member_creation_requests WHERE tenant_id = $1 AND idempotency_key = $2`,
            [tenant.id, requestId]
        );
        expect(requestRow.rows).toHaveLength(1);
        expect(requestRow.rows[0].patient_id).toBe(result.patientId);
    });

    it('#16b — requisições concorrentes com mesmo requestId geram apenas 1 paciente (reserva atômica)', async () => {
        const tenant = await createTenant(pool);
        const group  = await createGroup(pool, tenant.id);
        const requestId = uuidv4();

        // 3 chamadas idênticas simultâneas
        const results = await Promise.all([
            addMemberUseCase.execute({ tenantId: tenant.id, groupId: group.id, requestId, name: 'Concorrente' }),
            addMemberUseCase.execute({ tenantId: tenant.id, groupId: group.id, requestId, name: 'Concorrente' }),
            addMemberUseCase.execute({ tenantId: tenant.id, groupId: group.id, requestId, name: 'Concorrente' }),
        ]);

        // Todas devem resolver retornando o MESMO patientId
        const patientId1 = results[0].patientId;
        expect(results[1].patientId).toBe(patientId1);
        expect(results[2].patientId).toBe(patientId1);

        // O count real no banco deve ser 1
        const count = await pool.query(`SELECT COUNT(*) FROM psychotherapy_patients WHERE tenant_id = $1`, [tenant.id]);
        expect(Number(count.rows[0].count)).toBe(1);
    });

    it('#16c — rejeita reuso de requestId com payload diferente (conflito de hash)', async () => {
        const tenant = await createTenant(pool);
        const group  = await createGroup(pool, tenant.id);
        const requestId = uuidv4();

        // Primeira chamada
        await addMemberUseCase.execute({
            tenantId: tenant.id, groupId: group.id, requestId, name: 'Nome Original',
        });

        // Segunda chamada com o mesmo requestId mas payload diferente
        await expect(addMemberUseCase.execute({
            tenantId: tenant.id, groupId: group.id, requestId, name: 'Nome Diferente',
        })).rejects.toMatchObject({ statusCode: 409 });
    });
});
