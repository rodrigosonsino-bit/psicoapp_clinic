/**
 * groupCharges.integration.test.ts
 *
 * Testes de integração para CreateGroupChargesUseCase e ReplaceGroupChargeUseCase.
 * Valida idempotência concorrente via índice parcial e substituição após void.
 *
 * Cenários do plano: #10, #11
 */

import 'reflect-metadata';
import { Pool } from 'pg';
import { getTestPool, teardownTestDb, truncateTables } from './helpers/testDb';
import { createTenant, createGroup, createPatient, addGroupMember, createGroupPayment } from './helpers/fixtures';
import { CreateGroupChargesUseCase } from '../../application/useCases/CreateGroupChargesUseCase';
import { ReplaceGroupChargeUseCase } from '../../application/useCases/ReplaceGroupChargeUseCase';

jest.setTimeout(120_000);

const TABLES = [
    'financial_payments', 'group_payments', 'group_session_records',
    'therapy_group_members', 'therapy_groups',
    'psychotherapy_patients', 'tenants',
];

let pool: Pool;
let createChargesUseCase: CreateGroupChargesUseCase;
let replaceChargeUseCase: ReplaceGroupChargeUseCase;

beforeAll(async () => {
    pool = await getTestPool();
    createChargesUseCase = new CreateGroupChargesUseCase(pool);
    replaceChargeUseCase = new ReplaceGroupChargeUseCase(pool);
});

afterAll(async () => {
    await teardownTestDb();
});

afterEach(async () => {
    await truncateTables(pool, TABLES);
});

// Cenário #10
describe('CreateGroupChargesUseCase', () => {
    it('#10 — gera cobranças para todos os membros ativos do mês', async () => {
        const tenant   = await createTenant(pool);
        const patient1 = await createPatient(pool, tenant.id);
        const patient2 = await createPatient(pool, tenant.id);
        const group    = await createGroup(pool, tenant.id, { monthlyFeeCents: 20000 });

        await addGroupMember(pool, group.id, patient1.id, tenant.id);
        await addGroupMember(pool, group.id, patient2.id, tenant.id);

        const result = await createChargesUseCase.execute({
            tenantId: tenant.id, groupId: group.id,
            referenceMonth: '2025-02', dueDate: '2025-02-10',
        });

        expect(result.createdCount).toBe(2);
        expect(result.skippedCount).toBe(0);
    });

    it('#10b — segunda geração para o mesmo mês não cria duplicatas (idempotente)', async () => {
        const tenant  = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const group   = await createGroup(pool, tenant.id, { monthlyFeeCents: 20000 });
        await addGroupMember(pool, group.id, patient.id, tenant.id);

        await createChargesUseCase.execute({
            tenantId: tenant.id, groupId: group.id,
            referenceMonth: '2025-02', dueDate: '2025-02-10',
        });

        const result2 = await createChargesUseCase.execute({
            tenantId: tenant.id, groupId: group.id,
            referenceMonth: '2025-02', dueDate: '2025-02-10',
        });

        expect(result2.createdCount).toBe(0);
        expect(result2.skippedCount).toBe(1);

        const count = await pool.query(
            `SELECT COUNT(*) FROM group_payments WHERE group_id = $1 AND reference_month = '2025-02'`,
            [group.id]
        );
        expect(Number(count.rows[0].count)).toBe(1);
    });

    it('#10c — geração concorrente para mesmo mês produz exatamente 1 cobrança por paciente', async () => {
        const tenant  = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const group   = await createGroup(pool, tenant.id, { monthlyFeeCents: 20000 });
        await addGroupMember(pool, group.id, patient.id, tenant.id);

        await Promise.all([
            createChargesUseCase.execute({
                tenantId: tenant.id, groupId: group.id,
                referenceMonth: '2025-03', dueDate: '2025-03-10',
            }),
            createChargesUseCase.execute({
                tenantId: tenant.id, groupId: group.id,
                referenceMonth: '2025-03', dueDate: '2025-03-10',
            }),
        ]);

        const count = await pool.query(
            `SELECT COUNT(*) FROM group_payments WHERE group_id = $1 AND reference_month = '2025-03' AND status != 'voided'`,
            [group.id]
        );
        expect(Number(count.rows[0].count)).toBe(1);
    });

    it('#10d — rejeita grupo sem mensalidade fixa', async () => {
        const tenant  = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const group   = await createGroup(pool, tenant.id, { monthlyFeeCents: 0 });
        await addGroupMember(pool, group.id, patient.id, tenant.id);

        await expect(createChargesUseCase.execute({
            tenantId: tenant.id, groupId: group.id,
            referenceMonth: '2025-02', dueDate: '2025-02-10',
        })).rejects.toMatchObject({ statusCode: 400 });
    });
});

// Cenário #11
describe('ReplaceGroupChargeUseCase', () => {
    it('#11 — substitui cobrança voided por nova cobrança pending', async () => {
        const tenant  = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const group   = await createGroup(pool, tenant.id, { monthlyFeeCents: 20000 });
        await addGroupMember(pool, group.id, patient.id, tenant.id);

        // Criar cobrança e dar void
        const payment = await createGroupPayment(pool, {
            tenantId: tenant.id, groupId: group.id, patientId: patient.id, amountCents: 20000,
        });
        await pool.query(`
            UPDATE group_payments
            SET status = 'voided', voided_at = NOW(), voided_by = $2, void_reason = 'Teste'
            WHERE id = $1
        `, [payment.id, tenant.id]);

        // Substituir
        const result = await replaceChargeUseCase.execute({
            tenantId: tenant.id,
            groupPaymentId: payment.id,
            amountCents: 18000,
            dueDate: '2025-01-15',
        });

        expect(result.newPaymentId).toBeDefined();
        expect(result.newPaymentId).not.toBe(payment.id);

        // Verificar nova cobrança
        const newPayment = await pool.query(
            `SELECT status, amount_cents, original_amount_cents FROM group_payments WHERE id = $1`,
            [result.newPaymentId]
        );
        expect(newPayment.rows[0].status).toBe('pending');
        expect(newPayment.rows[0].amount_cents).toBe(18000);
        expect(newPayment.rows[0].original_amount_cents).toBe(18000);
    });

    it('#11b — rejeita substituição de cobrança que ainda está pending (não voided)', async () => {
        const tenant  = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const group   = await createGroup(pool, tenant.id, { monthlyFeeCents: 20000 });
        await addGroupMember(pool, group.id, patient.id, tenant.id);

        const payment = await createGroupPayment(pool, {
            tenantId: tenant.id, groupId: group.id, patientId: patient.id,
        });

        await expect(replaceChargeUseCase.execute({
            tenantId: tenant.id,
            groupPaymentId: payment.id,
            amountCents: 18000,
            dueDate: '2025-01-15',
        })).rejects.toMatchObject({ statusCode: 409 });
    });

    it('#11c — rejeita valor zero', async () => {
        const tenant  = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const group   = await createGroup(pool, tenant.id, { monthlyFeeCents: 20000 });
        const payment = await createGroupPayment(pool, {
            tenantId: tenant.id, groupId: group.id, patientId: patient.id,
        });

        await expect(replaceChargeUseCase.execute({
            tenantId: tenant.id,
            groupPaymentId: payment.id,
            amountCents: 0,
            dueDate: '2025-01-15',
        })).rejects.toMatchObject({ statusCode: 400 });
    });
});
