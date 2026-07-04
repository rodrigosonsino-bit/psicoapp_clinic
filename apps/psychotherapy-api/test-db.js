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
                END AS payment_status
            FROM therapy_group_members tgm
            JOIN psychotherapy_patients p  ON p.id  = tgm.patient_id
            JOIN therapy_groups tg         ON tg.id = tgm.group_id
            LEFT JOIN group_payments gp
                ON  gp.group_member_id = tgm.id
                AND gp.status != 'voided'
            WHERE tgm.group_id = '531e0a18-2477-417f-abb3-6afb30bd3c66'
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
