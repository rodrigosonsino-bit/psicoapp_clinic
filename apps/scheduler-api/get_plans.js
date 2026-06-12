const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const dbUrl = process.env.DATABASE_URL || "postgresql://postgres:secretpassword@localhost:5432/whatsapp_scheduler";

console.log('Connecting to:', dbUrl.split('@')[1] || dbUrl);

const client = new Client({
  connectionString: dbUrl,
  ssl: dbUrl.includes('railway') || dbUrl.includes('neon') || dbUrl.includes('supabase') ? { rejectUnauthorized: false } : false
});

async function main() {
  try {
    await client.connect();
    console.log('Connected successfully.');

    console.log('\n--- Plans Table ---');
    const plans = await client.query("SELECT * FROM plans;");
    console.log(JSON.stringify(plans.rows, null, 2));

  } catch (err) {
    console.error('Database error:', err.message);
  } finally {
    await client.end();
  }
}

main();
