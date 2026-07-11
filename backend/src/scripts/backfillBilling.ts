/**
 * Backfill de faturamento mensal para agendamentos já existentes.
 *
 * Uso:
 *   cd apps/psychotherapy
 *   npx ts-node src/scripts/backfillBilling.ts
 *
 * Idempotente: usa INSERT ... ON CONFLICT DO UPDATE com os valores recalculados.
 * Pode ser rodado múltiplas vezes com segurança.
 *
 * O que faz:
 *   Para cada par (tenant, patient, mês), agrega os agendamentos com status
 *   'attended' e 'no_show' e cria/atualiza o registro em psychotherapy_monthly_records.
 *   - per_session: expected_sessions = count(attended + no_show), absences = count(no_show)
 *   - monthly:     expected_sessions = valor fixo do cadastro (4/2/1), absences = count(no_show)
 */

import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    console.log('🔄 Iniciando backfill de faturamento...\n');

    const result = await pool.query(`
        INSERT INTO psychotherapy_monthly_records (
            id,
            tenant_id,
            patient_id,
            month,
            patient_name_snapshot,
            status,
            payment_type,
            session_price_cents,
            expected_sessions,
            absences,
            paid_sessions,
            payment_status,
            previous_month_paid_cents
        )
        SELECT
            gen_random_uuid(),
            a.tenant_id,
            a.patient_id,
            TO_CHAR(a.scheduled_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS month,
            p.name,
            p.status,
            p.payment_type,
            p.default_session_price_cents,

            -- expected_sessions:
            --   per_session → conta todos os atendimentos (attended + no_show)
            --   monthly     → valor fixo pelo tipo de frequência do paciente
            CASE p.payment_type
                WHEN 'per_session' THEN
                    COUNT(*) FILTER (WHERE a.status IN ('attended', 'no_show'))
                ELSE
                    CASE p.status
                        WHEN 'weekly'   THEN 4
                        WHEN 'biweekly' THEN 2
                        WHEN 'one_off'  THEN 1
                        ELSE 0
                    END
            END AS expected_sessions,

            COUNT(*) FILTER (WHERE a.status = 'no_show') AS absences,

            0          AS paid_sessions,
            'pending'  AS payment_status,
            0          AS previous_month_paid_cents

        FROM psychotherapy_appointments a
        JOIN psychotherapy_patients p ON p.id = a.patient_id
        WHERE a.status IN ('attended', 'no_show')
        GROUP BY
            a.tenant_id,
            a.patient_id,
            TO_CHAR(a.scheduled_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM'),
            p.name, p.status, p.payment_type, p.default_session_price_cents

        ON CONFLICT (tenant_id, month, patient_id)
        WHERE patient_id IS NOT NULL
        DO UPDATE SET
            expected_sessions = EXCLUDED.expected_sessions,
            absences          = EXCLUDED.absences,
            updated_at        = NOW()
    `);

    console.log(`✅ Registros criados/atualizados: ${result.rowCount}`);

    // Resumo por paciente
    const summary = await pool.query(`
        SELECT
            p.name,
            r.month,
            r.payment_type,
            r.expected_sessions,
            r.absences,
            r.session_price_cents
        FROM psychotherapy_monthly_records r
        JOIN psychotherapy_patients p ON p.id = r.patient_id
        ORDER BY p.name, r.month
    `);

    console.log('\nResumo do faturamento gerado:\n');
    let lastPatient = '';
    for (const row of summary.rows) {
        if (row.name !== lastPatient) {
            console.log(`  ${row.name} (${row.payment_type})`);
            lastPatient = row.name;
        }
        const price = row.session_price_cents
            ? `R$ ${(row.session_price_cents / 100).toFixed(2)}`
            : '(sem preço)';
        console.log(
            `    ${row.month}  →  ${row.expected_sessions} sessões  |  ${row.absences} faltas  |  ${price}/sessão`
        );
    }

    await pool.end();
    console.log('\nBackfill concluído.');
}

main().catch(err => {
    console.error('\n❌ Erro fatal:', err);
    pool.end().finally(() => process.exit(1));
});
