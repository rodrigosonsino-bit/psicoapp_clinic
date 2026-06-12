const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || "postgresql://postgres:ZqItlqXyKzUaTOrQWlZpOKYwInWpMWhu@autorack.proxy.rlwy.net:18659/railway" });

async function run() {
    try {
        const res = await pool.query('SELECT id, mp_plan_id FROM plans');
        console.log(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
run();
