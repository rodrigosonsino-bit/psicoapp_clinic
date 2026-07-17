import { Pool } from 'pg';
import { SaveExpenseDTO, SaveFixedExpenseDTO, PaginationOptions, PaginatedResult } from '../../domain/repositories/IPsychotherapyRepository';
import { PsychotherapyExpense } from '../../domain/models/PsychotherapyExpense';
import { PsychotherapyFixedExpense } from '../../domain/models/PsychotherapyFixedExpense';
import { NotFoundError } from '../../domain/errors/NotFoundError';
import { FixedExpenseRow } from './dbRowTypes';
import { validateTenantId, mapExpense } from './shared';
import { checkAndInstantiateFixedExpenses } from './FixedExpenseInstantiator';

/**
 * Extraído de PostgresPsychotherapyRepository (7 métodos de Expenses/Fixed Expenses
 * classificados como FOLHA — sem transação, sem side effect cross-domain) sem alterar
 * nenhuma linha de lógica. `listExpenses` (COMPLEXO — chama `checkAndInstantiateFixedExpenses`,
 * que grava despesas como side effect antes de listar) foi migrado aqui posteriormente.
 * `getDashboardAnalytics` permanece no arquivo principal (mesma chamada, via
 * PostgresBillingRepository). Ver
 * .claude/plans/pendencias-tecnicas-pos-quitacao-2026-07.md (item 1) e
 * .claude/plans/classificacao-postgres-psychotherapy-repository.md.
 *
 * `mapFixedExpense`/`formatDate` ficam privados aqui (diferente de `mapExpense`, que foi para
 * `shared.ts`) porque nenhum método que permanece no arquivo principal os utiliza.
 */
export class PostgresExpenseRepository {
    constructor(private readonly dbPool: Pool) {}

    async listExpenses(
        tenantId: string,
        start?: Date,
        end?: Date,
        pagination?: PaginationOptions
    ): Promise<PaginatedResult<PsychotherapyExpense>> {
        const validTenantId = validateTenantId(tenantId);

        // Auto-instantiate fixed expenses for current month and any months in start-end range.
        // Usa America/Sao_Paulo explicitamente (não new Date().getMonth(), que usa o fuso do
        // servidor — normalmente UTC no Railway — e podia calcular o "mês atual" errado perto
        // da virada do dia em BRT, achado na revisão de 04/07/2026).
        const currentMonth = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Sao_Paulo',
            year: 'numeric',
            month: '2-digit',
        }).format(new Date()).slice(0, 7);
        await checkAndInstantiateFixedExpenses(this.dbPool, this, validTenantId, currentMonth);

        if (start && end) {
            let tempDate = new Date(start);
            tempDate.setUTCDate(1);
            while (tempDate <= end) {
                const mStr = `${tempDate.getUTCFullYear()}-${String(tempDate.getUTCMonth() + 1).padStart(2, '0')}`;
                await checkAndInstantiateFixedExpenses(this.dbPool, this, validTenantId, mStr);
                tempDate.setUTCMonth(tempDate.getUTCMonth() + 1);
            }
        }

        let query = 'SELECT *, COUNT(*) OVER() AS total_count FROM psychotherapy_expenses WHERE tenant_id = $1';
        const params: any[] = [validTenantId];

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
            data: result.rows.map(row => mapExpense(row)),
            total
        };
    }

    async saveExpense(data: SaveExpenseDTO): Promise<PsychotherapyExpense> {
        const tenantId = validateTenantId(data.tenantId);
        const result = await this.dbPool.query(`
            INSERT INTO psychotherapy_expenses (
                id, tenant_id, date, amount_cents, description, category, fixed_expense_id, reference_month
            )
            VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id) DO UPDATE SET
                date = EXCLUDED.date,
                amount_cents = EXCLUDED.amount_cents,
                description = EXCLUDED.description,
                category = EXCLUDED.category,
                fixed_expense_id = EXCLUDED.fixed_expense_id,
                reference_month = EXCLUDED.reference_month,
                updated_at = NOW()
            WHERE psychotherapy_expenses.tenant_id = EXCLUDED.tenant_id
            RETURNING *;
        `, [
            data.id || null,
            tenantId,
            data.date,
            data.amountCents,
            data.description,
            data.category,
            data.fixedExpenseId || null,
            data.referenceMonth || null
        ]);

        if (result.rows.length === 0) throw new NotFoundError('Despesa não encontrada ou não autorizada');
        return mapExpense(result.rows[0]);
    }

    async deleteExpense(tenantId: string, id: string): Promise<void> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            DELETE FROM psychotherapy_expenses
            WHERE tenant_id = $1 AND id = $2;
        `, [validTenantId, id]);

        if (result.rowCount === 0) throw new NotFoundError('Despesa não encontrada ou não autorizada');
    }

    async listFixedExpenses(tenantId: string): Promise<PsychotherapyFixedExpense[]> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT * FROM psychotherapy_fixed_expenses
            WHERE tenant_id = $1
            ORDER BY day_of_month ASC, created_at DESC;
        `, [validTenantId]);

        return result.rows.map(row => this.mapFixedExpense(row));
    }

    async saveFixedExpense(data: SaveFixedExpenseDTO): Promise<PsychotherapyFixedExpense> {
        const tenantId = validateTenantId(data.tenantId);
        const result = await this.dbPool.query(`
            INSERT INTO psychotherapy_fixed_expenses (
                id, tenant_id, description, amount_cents, day_of_month, category, start_date, end_date, active
            )
            VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, COALESCE($9, TRUE))
            ON CONFLICT (id) DO UPDATE SET
                description = EXCLUDED.description,
                amount_cents = EXCLUDED.amount_cents,
                day_of_month = EXCLUDED.day_of_month,
                category = EXCLUDED.category,
                start_date = EXCLUDED.start_date,
                end_date = EXCLUDED.end_date,
                active = EXCLUDED.active,
                updated_at = NOW()
            WHERE psychotherapy_fixed_expenses.tenant_id = EXCLUDED.tenant_id
            RETURNING *;
        `, [
            data.id || null,
            tenantId,
            data.description,
            data.amountCents,
            data.dayOfMonth,
            data.category || null,
            data.startDate,
            data.endDate || null,
            data.active === undefined ? null : data.active
        ]);

        return this.mapFixedExpense(result.rows[0]);
    }

    async deleteFixedExpense(tenantId: string, id: string): Promise<void> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            DELETE FROM psychotherapy_fixed_expenses
            WHERE tenant_id = $1 AND id = $2;
        `, [validTenantId, id]);

        if (result.rowCount === 0) {
            throw new NotFoundError('Despesa fixa não encontrada ou não autorizada');
        }
    }

    async toggleFixedExpense(tenantId: string, id: string, active: boolean): Promise<PsychotherapyFixedExpense> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            UPDATE psychotherapy_fixed_expenses
            SET active = $3, updated_at = NOW()
            WHERE tenant_id = $1 AND id = $2
            RETURNING *;
        `, [validTenantId, id, active]);

        if (result.rows.length === 0) {
            throw new NotFoundError('Despesa fixa não encontrada ou não autorizada');
        }

        return this.mapFixedExpense(result.rows[0]);
    }

    async expenseExistsForMonth(tenantId: string, fixedExpenseId: string, month: string): Promise<boolean> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT 1 FROM psychotherapy_expenses
            WHERE tenant_id = $1 AND fixed_expense_id = $2 AND reference_month = $3
            LIMIT 1;
        `, [validTenantId, fixedExpenseId, month]);

        return result.rows.length > 0;
    }

    private mapFixedExpense(row: FixedExpenseRow): PsychotherapyFixedExpense {
        const startDateStr = this.formatDate(row.start_date) || '';
        const endDateStr = this.formatDate(row.end_date);
        return new PsychotherapyFixedExpense(
            row.id,
            row.tenant_id,
            row.description,
            row.amount_cents,
            row.day_of_month,
            row.category,
            startDateStr,
            endDateStr,
            row.active,
            new Date(row.created_at),
            new Date(row.updated_at)
        );
    }

    private formatDate(d: any): string | null {
        if (!d) return null;
        if (d instanceof Date) {
            return d.toISOString().split('T')[0];
        }
        if (typeof d === 'string') {
            return d.split('T')[0];
        }
        return String(d);
    }
}
