const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
    const res = await pool.query(`
        SELECT id, scheduled_at, status, google_event_id
        FROM psychotherapy_appointments
        WHERE scheduled_at >= '2026-06-01 00:00:00+00' AND scheduled_at < '2026-07-01 00:00:00+00'
        ORDER BY scheduled_at ASC
    `);
    console.log("\n=== APPOINTMENTS IN JUNE 2026 ===");
    console.log(res.rows);
    await pool.end();
}

check().catch(console.error);
