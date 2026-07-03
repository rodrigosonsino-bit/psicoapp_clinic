const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function run() {
  try {
    const res = await pool.query(
      `SELECT id, recipient_id, substring(content, 1, 60) as content, status, send_at, created_at
       FROM scheduled_messages 
       WHERE status = 'sent' OR status = 'failed'
       ORDER BY created_at DESC LIMIT 20`
    );
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error('Error querying database:', err.message);
  } finally {
    await pool.end();
  }
}

run();
