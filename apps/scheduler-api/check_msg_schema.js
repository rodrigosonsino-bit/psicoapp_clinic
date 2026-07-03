const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function run() {
  try {
    const res = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'scheduled_messages'
    `);
    console.log(res.rows);
  } catch (err) {
    console.error('Error querying schema:', err);
  } finally {
    await pool.end();
  }
}

run();
