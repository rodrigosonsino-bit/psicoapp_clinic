import cron from 'node-cron';
import { Pool } from 'pg';
import { logger } from '../logger/logger';

export class FixedExpensesCronJob {
    constructor(
        private readonly dbPool: Pool
    ) {}

    public start() {
        // Roda todo dia às 06:00 (timezone America/Sao_Paulo)
        cron.schedule('0 6 * * *', async () => {
            logger.info('⚙️ Iniciando processamento diário de despesas fixas...');
            try {
                await this.runFixedExpenses();
            } catch (error) {
                logger.error({ err: error }, '❌ Erro crítico ao processar o Cron Job de Despesas Fixas.');
            }
        }, {
            timezone: 'America/Sao_Paulo'
        });

        logger.info('🛰️ Cron Job de Geração de Despesas Fixas/Recorrentes ATIVADO (Roda diariamente às 06:00 America/Sao_Paulo).');
    }

    public async runFixedExpenses(): Promise<number> {
        // Obter data/hora atual no timezone de SP
        const d = new Date();
        const formattedStr = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Sao_Paulo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(d); // "YYYY-MM-DD"

        const [yearStr, monthStr, dayStr] = formattedStr.split('-');
        const currentDay = parseInt(dayStr, 10);
        const currentMonthStr = `${yearStr}-${monthStr}`; // "YYYY-MM"

        logger.info({ currentDay, currentMonthStr }, `🔍 Buscando templates de despesas fixas para o dia ${currentDay} de ${currentMonthStr}...`);

        // Obter os templates ativos para o dia do mês atual
        const templatesResult = await this.dbPool.query(`
            SELECT id, tenant_id, description, amount_cents, category, start_date, end_date
            FROM psychotherapy_fixed_expenses
            WHERE active = true AND day_of_month = $1;
        `, [currentDay]);

        if (templatesResult.rows.length === 0) {
            logger.info(`✅ Nenhuma despesa fixa ativa agendada para o dia ${currentDay}.`);
            return 0;
        }

        let generatedCount = 0;

        for (const template of templatesResult.rows) {
            const { id: templateId, tenant_id: tenantId, description, amount_cents: amountCents, category, start_date, end_date } = template;

            try {
                // Formatar datas para comparação 'YYYY-MM'
                const startMonthStr = this.formatToYearMonth(start_date);
                const endMonthStr = end_date ? this.formatToYearMonth(end_date) : null;

                // 1. Ignorar se currentMonthStr < startMonthStr
                if (currentMonthStr < startMonthStr) {
                    logger.debug({ templateId, currentMonthStr, startMonthStr }, 'Pula geração: data de início da despesa fixa é futura.');
                    continue;
                }

                // 2. Ignorar se end_date definido e currentMonthStr > endMonthStr
                if (endMonthStr && currentMonthStr > endMonthStr) {
                    logger.debug({ templateId, currentMonthStr, endMonthStr }, 'Pula geração: despesa fixa já expirou.');
                    continue;
                }

                // 3. Verificar idempotência (evitar duplicados no mesmo mês de referência para este template)
                const checkResult = await this.dbPool.query(`
                    SELECT 1 FROM psychotherapy_expenses
                    WHERE tenant_id = $1 AND fixed_expense_id = $2 AND reference_month = $3
                    LIMIT 1;
                `, [tenantId, templateId, currentMonthStr]);

                if (checkResult.rows.length > 0) {
                    logger.debug({ templateId, tenantId, currentMonthStr }, 'Pula geração: lançamento real já existe para este mês.');
                    continue;
                }

                // 4. Gerar despesa real
                // Criar a data correspondente a hoje às 00:00 UTC
                const expenseDate = new Date(Date.UTC(parseInt(yearStr, 10), parseInt(monthStr, 10) - 1, currentDay));

                await this.dbPool.query(`
                    INSERT INTO psychotherapy_expenses (
                        id, tenant_id, date, amount_cents, description, category, fixed_expense_id, reference_month, created_at, updated_at
                    ) VALUES (
                        gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), NOW()
                    );
                `, [
                    tenantId,
                    expenseDate,
                    amountCents,
                    description,
                    category || 'other',
                    templateId,
                    currentMonthStr
                ]);

                generatedCount++;
                logger.info({ templateId, tenantId, currentMonthStr }, `✨ Despesa real gerada a partir do template com sucesso: "${description}".`);
            } catch (err) {
                logger.error({ err, templateId, tenantId }, `Erro ao gerar despesa a partir do template "${description}"`);
            }
        }

        logger.info(`✅ Processamento de despesas fixas concluído. ${generatedCount} despesa(s) gerada(s).`);
        return generatedCount;
    }

    private formatToYearMonth(d: any): string {
        if (!d) return '';
        if (d instanceof Date) {
            return d.toISOString().split('T')[0].slice(0, 7);
        }
        if (typeof d === 'string') {
            return d.split('T')[0].slice(0, 7);
        }
        return String(d).slice(0, 7);
    }
}
