/**
 * migration.integration.test.ts
 *
 * Valida que as migrations se aplicam corretamente em banco limpo,
 * que o preflight da 062 bloqueia duplicatas e que a trigger de
 * imutabilidade de original_amount_cents funciona em PostgreSQL real.
 *
 * Cenários do plano: #1, #2, #3, #4, #17
 */

import 'reflect-metadata';
import { Pool } from 'pg';
import { getTestPool, teardownTestDb, truncateTables } from './helpers/testDb';
import { createTenant, createGroup, createPatient, addGroupMember, createGroupPayment } from './helpers/fixtures';
import { randomUUID as uuidv4 } from 'node:crypto';

jest.setTimeout(120_000); // Container pode demorar

let pool: Pool;

beforeAll(async () => {
    pool = await getTestPool();
});

afterAll(async () => {
    await teardownTestDb();
});

// Cenário #1
describe('Migration 062 — banco limpo', () => {
    it('tabela group_payments tem as colunas original_amount_cents e amount_paid_cents após migrations', async () => {
        const res = await pool.query(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'group_payments'
              AND column_name IN ('original_amount_cents', 'amount_paid_cents')
            ORDER BY column_name;
        `);
        const cols = res.rows.map((r: { column_name: string }) => r.column_name);
        expect(cols).toContain('original_amount_cents');
        expect(cols).toContain('amount_paid_cents');
    });

    it('constraint uq_group_payment_installment NÃO existe (foi removida pela 062)', async () => {
        const res = await pool.query(`
            SELECT constraint_name
            FROM information_schema.table_constraints
            WHERE table_name = 'group_payments'
              AND constraint_name = 'uq_group_payment_installment';
        `);
        expect(res.rows).toHaveLength(0);
    });

    it('índices uq_group_payments_*_active existem (modelo de billing dividido por charge_type — migrations 072/073/074)', async () => {
        // O índice único genérico original (migration 066) foi substituído por três
        // índices parciais específicos por charge_type quando o modelo de billing
        // se dividiu em monthly/upfront/session.
        const res = await pool.query(`
            SELECT indexname FROM pg_indexes
            WHERE tablename = 'group_payments'
              AND indexname IN (
                'uq_group_payments_monthly_active',
                'uq_group_payments_upfront_active',
                'uq_group_payments_session_active'
              );
        `);
        expect(res.rows).toHaveLength(3);
    });

    it('índice uq_calendar_events_group_session existe (migration 067)', async () => {
        const res = await pool.query(`
            SELECT indexname FROM pg_indexes
            WHERE tablename = 'calendar_events'
              AND indexname = 'uq_calendar_events_group_session';
        `);
        expect(res.rows).toHaveLength(1);
    });

    it('índice uq_appointments_group_patient_slot existe (migration 068)', async () => {
        const res = await pool.query(`
            SELECT indexname FROM pg_indexes
            WHERE tablename = 'psychotherapy_appointments'
              AND indexname = 'uq_appointments_group_patient_slot';
        `);
        expect(res.rows).toHaveLength(1);
    });
});

// Cenário #17
describe('Trigger — original_amount_cents é imutável', () => {
    const tables = [
        'financial_payments', 'group_payments', 'therapy_group_members',
        'therapy_groups', 'psychotherapy_patients', 'tenants',
    ];

    afterEach(async () => {
        await truncateTables(pool, tables);
    });

    it('lança exceção ao tentar alterar original_amount_cents após inserção', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const group = await createGroup(pool, tenant.id);
        const payment = await createGroupPayment(pool, {
            tenantId: tenant.id,
            groupId: group.id,
            patientId: patient.id,
            amountCents: 10000,
        });

        await expect(
            pool.query(`UPDATE group_payments SET original_amount_cents = 99999 WHERE id = $1`, [payment.id])
        ).rejects.toThrow(/imut\u00e1vel/i);
    });

    it('permite alterar amount_cents (campo mutável) sem acionar trigger', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const group = await createGroup(pool, tenant.id);
        const payment = await createGroupPayment(pool, {
            tenantId: tenant.id,
            groupId: group.id,
            patientId: patient.id,
            amountCents: 10000,
        });

        await expect(
            pool.query(`UPDATE group_payments SET amount_cents = 12000 WHERE id = $1`, [payment.id])
        ).resolves.not.toThrow();
    });
});

// Cenários #2 e #3 — preflight da migration 062
// Como a migration já foi aplicada, testamos a constraint chk_gp_paid_amount e
// o índice parcial que são o resultado do preflight ter passado num banco limpo.
describe('Constraint chk_gp_paid_amount — consistência status ↔ amount_paid_cents', () => {
    const tables = [
        'group_payments', 'therapy_group_members', 'therapy_groups',
        'psychotherapy_patients', 'tenants',
    ];

    afterEach(async () => {
        await truncateTables(pool, tables);
    });

    it('rejeita inserção de cobrança pending com amount_paid_cents preenchido', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const group = await createGroup(pool, tenant.id);

        await expect(pool.query(`
            INSERT INTO group_payments (
                id, tenant_id, group_id, patient_id,
                reference_month, amount_cents, original_amount_cents,
                amount_paid_cents, status, due_date
            ) VALUES (
                gen_random_uuid(), $1, $2, $3,
                '2025-01', 10000, 10000, 10000, 'pending', '2025-01-10'
            )
        `, [tenant.id, group.id, patient.id])).rejects.toThrow();
    });

    it('rejeita inserção de cobrança paid sem amount_paid_cents', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const group = await createGroup(pool, tenant.id);

        await expect(pool.query(`
            INSERT INTO group_payments (
                id, tenant_id, group_id, patient_id,
                reference_month, amount_cents, original_amount_cents,
                status, due_date
            ) VALUES (
                gen_random_uuid(), $1, $2, $3,
                '2025-01', 10000, 10000, 'paid', '2025-01-10'
            )
        `, [tenant.id, group.id, patient.id])).rejects.toThrow();
    });
});
