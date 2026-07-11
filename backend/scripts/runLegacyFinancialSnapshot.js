const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const CSV_PATH = path.join(__dirname, '..', 'legacy_financial_snapshots.csv');

async function runLegacyFinancialSnapshot() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        console.error('❌ DATABASE_URL não definida.');
        process.exit(1);
    }

    const pool = new Pool({ connectionString: databaseUrl });
    const client = await pool.connect();

    try {
        console.log('🏁 Iniciando data migration: legacy_financial_snapshots_v1...');

        await client.query(`
            INSERT INTO data_migrations (name, status, rows_processed, started_at)
            VALUES ('legacy_financial_snapshots_v1', 'running', 0, NOW())
            ON CONFLICT (name) DO UPDATE SET status = 'running', started_at = NOW();
        `);

        // Busca registros mensais para cálculo do snapshot
        const { rows: records } = await client.query(`
            SELECT id, tenant_id, patient_id, month, patient_name_snapshot, payment_type,
                   session_price_cents, expected_sessions, paid_sessions, previous_month_paid_cents
            FROM psychotherapy_monthly_records
            WHERE patient_id IS NOT NULL;
        `);

        console.log(`   - Calculando snapshot para ${records.length} registros mensais...`);

        const csvRows = [
            'tenant_id,patient_id,patient_name,month,payment_type,expected_sessions,paid_sessions,session_price_cents,previous_month_paid_cents,calculated_amount_cents,status'
        ];

        let totalProcessed = 0;

        await client.query('BEGIN');
        try {
            for (const rec of records) {
                const sessionPrice = rec.session_price_cents ?? 0;
                const expected = rec.expected_sessions ?? 0;
                const paid = rec.paid_sessions ?? 0;
                const prevPaid = rec.previous_month_paid_cents ?? 0;

                let calculatedAmount = 0;

                if (rec.payment_type === 'monthly') {
                    // monthly: proporcional ao target pago, limitado ao valor mensal
                    if (expected > 0) {
                        calculatedAmount = Math.min(sessionPrice, Math.round((paid / expected) * sessionPrice));
                    } else if (paid > 0) {
                        calculatedAmount = sessionPrice;
                    }
                } else {
                    // per_session: preço por sessão * sessões pagas
                    calculatedAmount = sessionPrice * paid;
                }

                // incluir previous_month_paid_cents
                const finalAmount = calculatedAmount + prevPaid;

                // Upsert em legacy_financial_snapshots
                await client.query(`
                    INSERT INTO legacy_financial_snapshots (
                        tenant_id, patient_id, month, amount_cents, paid_sessions,
                        source_formula_version, status, approved_at, approved_by
                    )
                    VALUES ($1, $2, $3, $4, $5, 'v1', 'pending_review', NULL, NULL)
                    ON CONFLICT (tenant_id, patient_id, month) 
                    DO UPDATE SET amount_cents = EXCLUDED.amount_cents,
                                  paid_sessions = EXCLUDED.paid_sessions,
                                  source_formula_version = EXCLUDED.source_formula_version;
                `, [rec.tenant_id, rec.patient_id, rec.month.trim(), finalAmount, paid]);

                // Adiciona linha no CSV
                csvRows.push(`${rec.tenant_id},${rec.patient_id},"${rec.patient_name_snapshot}",${rec.month.trim()},${rec.payment_type},${expected},${paid},${sessionPrice},${prevPaid},${finalAmount},pending_review`);
                totalProcessed++;
            }

            // Escreve arquivo CSV
            fs.writeFileSync(CSV_PATH, csvRows.join('\n'), 'utf8');
            console.log(`   - Arquivo CSV gerado em: ${CSV_PATH}`);

            await client.query(`
                UPDATE data_migrations
                SET status = 'completed', rows_processed = $1, completed_at = NOW(), last_error = NULL
                WHERE name = 'legacy_financial_snapshots_v1';
            `, [totalProcessed]);

            await client.query('COMMIT');
            console.log(`✅ Backfill de snapshots financeiros concluído com sucesso!`);

        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }

    } catch (error) {
        console.error('❌ Erro crítico no backfill:', error.message);
        try {
            await client.query(`
                UPDATE data_migrations 
                SET status = 'failed', last_error = $1, completed_at = NOW()
                WHERE name = 'legacy_financial_snapshots_v1';
            `, [error.message]);
        } catch (_) {}
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

runLegacyFinancialSnapshot();
