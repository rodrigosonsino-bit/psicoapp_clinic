const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function run() {
  let res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'group_session_records'");
  console.log("group_session_records cols:", res.rows.map(r => r.column_name).join(', '));
  res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'group_payments'");
  console.log("group_payments cols:", res.rows.map(r => r.column_name).join(', '));
  process.exit(0);
}
run();
