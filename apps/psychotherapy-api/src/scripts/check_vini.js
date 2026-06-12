const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
    const res = await pool.query(`
        SELECT id, scheduled_at, status, google_event_id
        FROM psychotherapy_appointments
        WHERE patient_id = '3e4b7d57-f135-46b8-8283-2095ee9b9b5e'
        ORDER BY scheduled_at DESC
        LIMIT 20
    `);
    console.log("\n=== APPOINTMENTS FOR VINI ===");
    console.log(res.rows);
    await pool.end();
}

check().catch(console.error);
