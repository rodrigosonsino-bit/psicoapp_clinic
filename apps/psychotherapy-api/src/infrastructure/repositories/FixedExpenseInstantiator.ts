import { Pool } from 'pg';
import { validateTenantId } from './shared';
import type { PostgresExpenseRepository } from './PostgresExpenseRepository';

/**
 * Extraído de PostgresPsychotherapyRepository.checkAndInstantiateFixedExpenses sem alterar
 * nenhuma linha de lógica — chamado tanto por `listExpenses` (migrado para
 * PostgresExpenseRepository) quanto por `getDashboardAnalytics` (migrado para
 * PostgresBillingRepository), por isso vive como módulo compartilhado (mesmo padrão de
 * MonthlyRecordSynchronizer), recebendo o `PostgresExpenseRepository` já instanciado em vez de
 * duplicar a query de `listFixedExpenses`. Ver
 * .claude/plans/pendencias-tecnicas-pos-quitacao-2026-07.md (item 1) e
 * .claude/plans/classificacao-postgres-psychotherapy-repository.md.
 */
export async function checkAndInstantiateFixedExpenses(
    dbPool: Pool,
    expenseRepository: PostgresExpenseRepository,
    tenantId: string,
    monthStr: string
): Promise<void> {
    const validTenantId = validateTenantId(tenantId);
    const fixedExpenses = await expenseRepository.listFixedExpenses(validTenantId);

    for (const fe of fixedExpenses) {
        if (!fe.active) continue;

        const startMonth = fe.startDate.substring(0, 7); // YYYY-MM
        if (monthStr < startMonth) continue;

        if (fe.endDate) {
            const endMonth = fe.endDate.substring(0, 7); // YYYY-MM
            if (monthStr > endMonth) continue;
        }

        const [yearStr, mStr] = monthStr.split('-');
        const year = parseInt(yearStr, 10);
        const monthIdx = parseInt(mStr, 10) - 1;
        const day = Math.min(fe.dayOfMonth, 28);
        const date = new Date(Date.UTC(year, monthIdx, day, 12, 0, 0));

        // INSERT atômico com ON CONFLICT DO NOTHING no índice único parcial
        // uq_psychotherapy_expenses_fixed_month (migration 081) — substitui o antigo
        // padrão SELECT (expenseExistsForMonth) + INSERT (saveExpense), que tinha race
        // condition real: duas requests concorrentes (2 abas, polling duplo do dashboard)
        // podiam ambas ver "não existe" e inserir, duplicando a despesa do mês.
        // saveExpense() não serve aqui porque sempre gera um id novo e faz
        // ON CONFLICT (id) DO UPDATE — nunca colide, então nunca detectava a duplicata.
        await dbPool.query(`
            INSERT INTO psychotherapy_expenses (
                id, tenant_id, date, amount_cents, description, category,
                fixed_expense_id, reference_month
            ) VALUES (
                gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7
            )
            ON CONFLICT (tenant_id, fixed_expense_id, reference_month)
                WHERE fixed_expense_id IS NOT NULL
                DO NOTHING
        `, [validTenantId, date, fe.amountCents, fe.description, fe.category || 'other', fe.id, monthStr]);
    }
}
