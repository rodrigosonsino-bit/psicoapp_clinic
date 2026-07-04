const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:password@localhost:5432/psicoapp' });

async function run() {
  try {
    const res = await pool.query(`
            SELECT
                p.id            AS patient_id,
                p.name,
                COALESCE(SUM(gp.amount_cents) FILTER (WHERE gp.status = 'paid'), 0)::int AS total_paid_cents,
                COUNT(gp.id) FILTER (WHERE gp.status != 'voided')::int                   AS payments_count,
                MAX(gp.total_installments)                                               AS total_installments,
                tg.monthly_fee_cents,
                CASE
                    WHEN tg.monthly_fee_cents IS NULL OR tg.monthly_fee_cents = 0 THEN 'paid'
                    WHEN COALESCE(SUM(gp.amount_cents) FILTER (WHERE gp.status = 'paid'), 0) = 0 THEN 'pending'
                    WHEN COALESCE(SUM(gp.amount_cents) FILTER (WHERE gp.status = 'paid'), 0) >= tg.monthly_fee_cents THEN 'paid'
                    ELSE 'partial'
                END AS payment_status,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'id', gp.id,
                            'amount_cents', gp.amount_cents,
                            'payment_method', gp.payment_method,
                            'total_installments', gp.total_installments,
                            'installment_number', gp.installment_number,
                            'installment_group_id', gp.installment_group_id,
                            'paid_at', gp.paid_at,
                            'notes', gp.notes,
                            'status', gp.status,
                            'due_date', gp.due_date
                        ) ORDER BY gp.due_date ASC
                    ) FILTER (WHERE gp.id IS NOT NULL AND gp.status != 'voided'),
                    '[]'::json
                ) AS payments
            FROM therapy_group_members tgm
            JOIN psychotherapy_patients p  ON p.id  = tgm.patient_id
            JOIN therapy_groups tg         ON tg.id = tgm.group_id
            LEFT JOIN group_payments gp
                ON  gp.group_member_id = tgm.id
                AND gp.reference_month = '2026-07'
                AND gp.status != 'voided'
            WHERE tgm.group_id   = '531e0a18-2477-417f-abb3-6afb30bd3c66'
              AND tgm.left_at   IS NULL
            GROUP BY p.id, p.name, tg.monthly_fee_cents
            ORDER BY p.name ASC
            LIMIT 5;
    `);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error("SQL ERROR:", err.message);
  }
  process.exit(0);
}
run();
