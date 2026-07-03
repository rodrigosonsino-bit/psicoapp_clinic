const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:secretpassword@localhost:5432/whatsapp_scheduler'
});

async function run() {
  try {
    const res = await pool.query(
      `SELECT id, recipient_id, substring(content, 1, 40) as content, status, send_at 
       FROM scheduled_messages 
       ORDER BY created_at DESC LIMIT 50`
    );
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error('Error querying local database:', err.message);
  } finally {
    await pool.end();
  }
}

run();
