const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'apps/psychotherapy/.env') });

async function run() {
  const connectionString = process.env.DATABASE_URL || "postgresql://postgres:secretpassword@localhost:5432/whatsapp_scheduler";
  console.log('Connecting to:', connectionString);
  const client = new Client({
    connectionString,
    ssl: connectionString.includes('railway') ? { rejectUnauthorized: false } : false
  });
  await client.connect();

  console.log('\n--- THERAPY GROUPS ---');
  const groupsRes = await client.query('SELECT id, name, monthly_fee_cents FROM therapy_groups');
  console.log(groupsRes.rows);

  console.log('\n--- GROUP PAYMENTS ---');
  const paymentsRes = await client.query('SELECT id, tenant_id, group_id, patient_id, reference_month, amount_cents, payment_method, notes FROM group_payments');
  console.log(paymentsRes.rows);

  await client.end();
}

run().catch(console.error);
