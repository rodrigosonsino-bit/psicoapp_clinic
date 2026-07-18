/**
 * postgresExpenseRepository.integration.test.ts
 *
 * Testes de integração contra PostgreSQL real para PostgresExpenseRepository.listExpenses —
 * método COMPLEXO (chama checkAndInstantiateFixedExpenses, que grava despesas fixas como side
 * effect antes de listar), extraído de PostgresPsychotherapyRepository e até aqui só verificado
 * por diff mecânico + build.
 *
 * Cobre: filtro por tenant, filtro por intervalo de datas, paginação, e a auto-instanciação de
 * despesa fixa do mês corrente (dedupe via ON CONFLICT DO NOTHING no índice único parcial da
 * migration 081 — chamar listExpenses duas vezes não deve duplicar a despesa gerada).
 */

import 'reflect-metadata';
import { Pool } from 'pg';
import { getTestPool, teardownTestDb, truncateTables } from './helpers/testDb';
import { createTenant } from './helpers/fixtures';
import { PostgresExpenseRepository } from '../../infrastructure/repositories/PostgresExpenseRepository';
import { SaveFixedExpenseDTO } from '../../domain/repositories/IPsychotherapyRepository';

jest.setTimeout(120_000);

const TABLES = ['psychotherapy_expenses', 'psychotherapy_fixed_expenses', 'tenants'];

let pool: Pool;
let expenseRepo: PostgresExpenseRepository;

beforeAll(async () => {
    pool = await getTestPool();
    expenseRepo = new PostgresExpenseRepository(pool);
});

afterAll(async () => {
    await teardownTestDb();
});

afterEach(async () => {
    await truncateTables(pool, TABLES);
});

// Mesmo cálculo de "mês corrente" usado internamente por listExpenses (America/Sao_Paulo).
function currentMonthBRT(): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
    }).format(new Date()).slice(0, 7);
}

describe('PostgresExpenseRepository.listExpenses', () => {
    it('lista só despesas do tenant, ordenadas por data desc', async () => {
        const tenant = await createTenant(pool);
        const otherTenant = await createTenant(pool);

        await expenseRepo.saveExpense({ tenantId: tenant.id, date: new Date('2025-02-01'), amountCents: 1000, description: 'A', category: 'other' });
        await expenseRepo.saveExpense({ tenantId: tenant.id, date: new Date('2025-02-15'), amountCents: 2000, description: 'B', category: 'other' });
        await expenseRepo.saveExpense({ tenantId: otherTenant.id, date: new Date('2025-02-10'), amountCents: 3000, description: 'C (outro tenant)', category: 'other' });

        const result = await expenseRepo.listExpenses(tenant.id);

        expect(result.total).toBe(2);
        expect(result.data.map(e => e.description)).toEqual(['B', 'A']);
    });

    it('filtra por intervalo de datas (start/end)', async () => {
        const tenant = await createTenant(pool);
        await expenseRepo.saveExpense({ tenantId: tenant.id, date: new Date('2025-01-15'), amountCents: 1000, description: 'Fora do range (antes)', category: 'other' });
        await expenseRepo.saveExpense({ tenantId: tenant.id, date: new Date('2025-02-15'), amountCents: 2000, description: 'Dentro do range', category: 'other' });
        await expenseRepo.saveExpense({ tenantId: tenant.id, date: new Date('2025-03-15'), amountCents: 3000, description: 'Fora do range (depois)', category: 'other' });

        const result = await expenseRepo.listExpenses(tenant.id, new Date('2025-02-01'), new Date('2025-02-28'));

        expect(result.total).toBe(1);
        expect(result.data[0].description).toBe('Dentro do range');
    });

    it('pagina os resultados respeitando limit/offset e retorna o total real (não só da página)', async () => {
        const tenant = await createTenant(pool);
        for (let i = 0; i < 5; i++) {
            await expenseRepo.saveExpense({
                tenantId: tenant.id, date: new Date(`2025-02-0${i + 1}`),
                amountCents: 1000, description: `Despesa ${i}`, category: 'other',
            });
        }

        const page1 = await expenseRepo.listExpenses(tenant.id, undefined, undefined, { page: 1, limit: 2 });
        const page2 = await expenseRepo.listExpenses(tenant.id, undefined, undefined, { page: 2, limit: 2 });

        expect(page1.total).toBe(5);
        expect(page1.data).toHaveLength(2);
        expect(page2.data).toHaveLength(2);
        expect(page1.data[0].id).not.toBe(page2.data[0].id);
    });

    it('auto-instancia a despesa fixa ativa do mês corrente exatamente uma vez, mesmo chamando listExpenses duas vezes', async () => {
        const tenant = await createTenant(pool);
        const dto: SaveFixedExpenseDTO = {
            tenantId: tenant.id,
            description: 'Aluguel do consultório',
            amountCents: 250000,
            dayOfMonth: 5,
            category: 'rent',
            startDate: '2020-01-01',
        };
        const fixedExpense = await expenseRepo.saveFixedExpense(dto);

        await expenseRepo.listExpenses(tenant.id);
        await expenseRepo.listExpenses(tenant.id);

        const rows = await pool.query(
            'SELECT * FROM psychotherapy_expenses WHERE tenant_id = $1 AND fixed_expense_id = $2',
            [tenant.id, fixedExpense.id]
        );
        expect(rows.rows).toHaveLength(1);
        expect(rows.rows[0].reference_month.trim()).toBe(currentMonthBRT());
        expect(rows.rows[0].amount_cents).toBe(250000);
    });

    it('não instancia despesa fixa inativa', async () => {
        const tenant = await createTenant(pool);
        const fixedExpense = await expenseRepo.saveFixedExpense({
            tenantId: tenant.id, description: 'Assinatura cancelada', amountCents: 5000,
            dayOfMonth: 10, category: 'other', startDate: '2020-01-01', active: false,
        });

        await expenseRepo.listExpenses(tenant.id);

        const rows = await pool.query(
            'SELECT * FROM psychotherapy_expenses WHERE tenant_id = $1 AND fixed_expense_id = $2',
            [tenant.id, fixedExpense.id]
        );
        expect(rows.rows).toHaveLength(0);
    });
});
