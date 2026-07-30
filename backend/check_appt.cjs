const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
    try {
        const apptId = 'bee7a566-8b97-401a-a444-7f5319de12db';
        const res = await pool.query(`SELECT * FROM psychotherapy_reminders_log WHERE appointment_id = $1`, [apptId]);
        console.log("Reminders log for Lucilene's 07:40 appointment:", res.rows);
    } catch(err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}
check();
