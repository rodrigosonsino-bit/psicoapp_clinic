const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:password@localhost:5432/psicoapp' });

async function run() {
    const res = await pool.query(`
        SELECT p.name, tgm.id as group_member_id, tgm.group_id
        FROM psychotherapy_patients p
        JOIN therapy_group_members tgm ON tgm.patient_id = p.id
        WHERE p.name ILIKE '%CARMEN%'
    `);
    console.log("CARMEN:", res.rows);
    
    if (res.rows.length > 0) {
        const memberId = res.rows[0].group_member_id;
        const policies = await pool.query(`
            SELECT * FROM therapy_group_member_billing_policies
            WHERE member_id = $1
        `, [memberId]);
        console.log("Policies:", policies.rows);
        
        const payments = await pool.query(`
            SELECT * FROM group_payments
            WHERE group_member_id = $1
        `, [memberId]);
        console.log("Payments:", payments.rows);
    }
    
    process.exit(0);
}
run();
