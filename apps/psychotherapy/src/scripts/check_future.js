const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
    const res = await pool.query(`
        SELECT id, patient_id, scheduled_at, status, google_event_id
        FROM psychotherapy_appointments
        WHERE scheduled_at > NOW()
        ORDER BY scheduled_at ASC
        LIMIT 15
    `);
    console.log("\n=== FUTUROS AGENDAMENTOS NO BANCO ===");
    console.log(res.rows);
    await pool.end();
}

check().catch(console.error);
