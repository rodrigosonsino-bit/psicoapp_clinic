/**
 * fixedExpenses.integration.test.ts
 *
 * Teste de REGRESSÃO pra race condition confirmada em checkAndInstantiateFixedExpenses
 * (auditoria 03/07/2026, revisão Codex CLI, corrigida em migration 081): duas chamadas
 * concorrentes a listExpenses (ex: 2 abas abertas, ou o dashboard fazendo polling duplo)
 * podiam ambas "não ver" a despesa fixa do mês ainda instanciada e inserir duas cópias.
 *
 * A correção troca o padrão SELECT (expenseExistsForMonth) + INSERT (saveExpense, que
 * sempre gera id novo e nunca colide) por um INSERT atômico com
 * ON CONFLICT (tenant_id, fixed_expense_id, reference_month) DO NOTHING, apoiado no
 * índice único parcial uq_psychotherapy_expenses_fixed_month (migration 081).
 */

import 'reflect-metadata';
import { Pool } from 'pg';
import { getTestPool, teardownTestDb, truncateTables } from './helpers/testDb';
import { createTenant } from './helpers/fixtures';
import { PostgresPsychotherapyRepository } from '../../infrastructure/repositories/PostgresPsychotherapyRepository';

jest.setTimeout(120_000);

const TABLES = ['psychotherapy_expenses', 'psychotherapy_fixed_expenses', 'tenants'];

let pool: Pool;
let repo: PostgresPsychotherapyRepository;

beforeAll(async () => {
    pool = await getTestPool();
    repo = new PostgresPsychotherapyRepository(pool);
});

afterAll(async () => {
    await teardownTestDb();
});

afterEach(async () => {
    await truncateTables(pool, TABLES);
});

function currentMonthStr(): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit',
    }).format(new Date()).slice(0, 7);
}

describe('[REGRESSÃO] checkAndInstantiateFixedExpenses — sem duplicação em chamadas concorrentes', () => {
    it('#1 — 5 chamadas concorrentes a listExpenses geram só 1 despesa do mês (não 5)', async () => {
        const tenant = await createTenant(pool);
        const fixedExpense = await repo.saveFixedExpense({
            tenantId: tenant.id,
            description: 'Aluguel',
            amountCents: 150000,
            dayOfMonth: 5,
            startDate: '2020-01-01',
            active: true,
        });

        // 5 chamadas concorrentes, simulando 2 abas abertas + polling do dashboard
        await Promise.all(Array.from({ length: 5 }, () => repo.listExpenses(tenant.id)));

        const rows = await pool.query(
            `SELECT id FROM psychotherapy_expenses WHERE tenant_id = $1 AND fixed_expense_id = $2 AND reference_month = $3`,
            [tenant.id, fixedExpense.id, currentMonthStr()]
        );
        expect(rows.rows).toHaveLength(1);
    });

    it('#2 — chamada única instancia normalmente a despesa fixa do mês', async () => {
        const tenant = await createTenant(pool);
        const fixedExpense = await repo.saveFixedExpense({
            tenantId: tenant.id,
            description: 'Internet',
            amountCents: 12000,
            dayOfMonth: 10,
            startDate: '2020-01-01',
            active: true,
        });

        await repo.listExpenses(tenant.id);

        const rows = await pool.query(
            `SELECT amount_cents FROM psychotherapy_expenses WHERE tenant_id = $1 AND fixed_expense_id = $2`,
            [tenant.id, fixedExpense.id]
        );
        expect(rows.rows).toHaveLength(1);
        expect(rows.rows[0].amount_cents).toBe(12000);
    });

    it('#3 — despesa fixa inativa não é instanciada', async () => {
        const tenant = await createTenant(pool);
        await repo.saveFixedExpense({
            tenantId: tenant.id,
            description: 'Assinatura cancelada',
            amountCents: 5000,
            dayOfMonth: 1,
            startDate: '2020-01-01',
            active: false,
        });

        await repo.listExpenses(tenant.id);

        const rows = await pool.query(
            `SELECT id FROM psychotherapy_expenses WHERE tenant_id = $1`,
            [tenant.id]
        );
        expect(rows.rows).toHaveLength(0);
    });
});
