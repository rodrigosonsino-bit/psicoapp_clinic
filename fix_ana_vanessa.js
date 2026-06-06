const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  const groupId = '531e0a18-2477-417f-abb3-6afb30bd3c66';
  const pids = ['6cf25d06-df49-4e4b-b934-245ea05f3b6a', 'c521fb6e-795e-4f4a-9f46-f3b01273d174'];

  for(let pid of pids) {
    try {
      await client.query(`
        INSERT INTO therapy_group_members (group_id, patient_id) 
        VALUES ($1, $2) 
        ON CONFLICT (group_id, patient_id) DO UPDATE SET left_at = NULL
      `, [groupId, pid]);
      console.log('Vinculado paciente', pid);
    } catch(err) {
      console.error('Erro em', pid, err.message);
    }
  }

  await client.end();
}

run().catch(console.error);
