const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function runMigration() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mp_events (
        event_id VARCHAR PRIMARY KEY,
        type VARCHAR,
        processed_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log("Created mp_events");

    await pool.query(`
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS mp_subscription_id VARCHAR;
    `);
    console.log("Added mp_subscription_id to tenants");
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

runMigration();
