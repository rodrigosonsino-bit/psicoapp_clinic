import { injectable, inject } from 'tsyringe';
import { Pool } from 'pg';
import { AppError } from '../../domain/errors/AppError';

@injectable()
export class ApproveTenantCutoverUseCase {
    constructor(
        @inject(Pool) private readonly dbPool: Pool
    ) {}

    async execute(tenantId: string, cutoverDateStr: string, operatorId: string): Promise<void> {
        if (!tenantId || !cutoverDateStr || !operatorId) {
            throw new AppError('Dados incompletos para aprovação de cutover.', 400);
        }

        const cutoverDate = new Date(cutoverDateStr);
        if (isNaN(cutoverDate.getTime())) {
            throw new AppError('Data de cutover inválida.', 400);
        }

        const client = await this.dbPool.connect();
        try {
            await client.query('BEGIN');

            // 1. Validar se todos os snapshots anteriores ao cutover estão 'approved'
            const pendingSnapRes = await client.query(`
                SELECT COUNT(*) as count 
                FROM legacy_financial_snapshots
                WHERE tenant_id = $1 AND status != 'approved';
            `, [tenantId]);

            const pendingSnaps = parseInt(pendingSnapRes.rows[0].count, 10);
            if (pendingSnaps > 0) {
                throw new AppError(`Existem ${pendingSnaps} snapshots financeiros legados pendentes de revisão/aprovação.`, 400);
            }

            // Converter cutoverDate para string de mês YYYY-MM
            const cutoverMonth = cutoverDate.toISOString().slice(0, 7);

            // 2. Validar se expected_amount_cents está populado pós-cutover
            const missingExpectRes = await client.query(`
                SELECT COUNT(*) as count
                FROM psychotherapy_monthly_records
                WHERE tenant_id = $1 AND month >= $2 AND expected_amount_cents IS NULL;
            `, [tenantId, cutoverMonth]);

            const missingExpect = parseInt(missingExpectRes.rows[0].count, 10);
            if (missingExpect > 0) {
                throw new AppError(`Existem ${missingExpect} registros mensais pós-cutover sem expected_amount_cents preenchido.`, 400);
            }

            // 3. Validar se há gaps nos snapshots aprovados para cada paciente ativo
            // Para cada paciente, do seu primeiro mês de registro até o mês anterior ao cutover
            const patientsRes = await client.query(`
                SELECT DISTINCT patient_id 
                FROM psychotherapy_monthly_records
                WHERE tenant_id = $1 AND patient_id IS NOT NULL;
            `, [tenantId]);

            for (const pat of patientsRes.rows) {
                const patientId = pat.patient_id;

                const minMonthRes = await client.query(`
                    SELECT MIN(month) as min_month 
                    FROM psychotherapy_monthly_records
                    WHERE tenant_id = $1 AND patient_id = $2;
                `, [tenantId, patientId]);

                const minMonthStr = minMonthRes.rows[0]?.min_month;
                if (!minMonthStr) continue;

                // Gerar lista de meses de minMonthStr até o mês anterior ao cutoverMonth
                const startYear = parseInt(minMonthStr.slice(0, 4), 10);
                const startMonth = parseInt(minMonthStr.slice(5, 7), 10);
                const cutYear = parseInt(cutoverMonth.slice(0, 4), 10);
                const cutMonth = parseInt(cutoverMonth.slice(5, 7), 10);

                let tempYear = startYear;
                let tempMonth = startMonth;

                const requiredMonths: string[] = [];
                while (tempYear < cutYear || (tempYear === cutYear && tempMonth < cutMonth)) {
                    requiredMonths.push(`${tempYear}-${String(tempMonth).padStart(2, '0')}`);
                    tempMonth++;
                    if (tempMonth > 12) {
                        tempMonth = 1;
                        tempYear++;
                    }
                }

                if (requiredMonths.length > 0) {
                    const existingSnapsRes = await client.query(`
                        SELECT month FROM legacy_financial_snapshots
                        WHERE tenant_id = $1 AND patient_id = $2 AND status = 'approved';
                    `, [tenantId, patientId]);

                    const existingMonths = new Set(existingSnapsRes.rows.map(r => r.month.trim()));
                    const gaps = requiredMonths.filter(m => !existingMonths.has(m));

                    if (gaps.length > 0) {
                        throw new AppError(`Identificados gaps de faturamento legado para o paciente ${patientId} nos meses: ${gaps.join(', ')}`, 400);
                    }
                }
            }

            // 4. Gravar/aprovar cutover
            await client.query(`
                INSERT INTO tenant_financial_cutovers (tenant_id, cutover_at, status, approved_at, approved_by)
                VALUES ($1, $2, 'approved', NOW(), $3)
                ON CONFLICT (tenant_id) 
                DO UPDATE SET cutover_at = EXCLUDED.cutover_at,
                              status = 'approved',
                              approved_at = NOW(),
                              approved_by = EXCLUDED.approved_by;
            `, [tenantId, cutoverDate, operatorId]);

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}
