const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://neondb_owner:npg_OilvbUx97fWr@ep-curly-hill-af1mhb7g-pooler.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require' });
async function run() {
    await client.connect();
    const res = await client.query('SELECT tenant_id, substring(key from \'^[^\:]+\') as prefix, count(*) FROM whatsapp_auth GROUP BY tenant_id, prefix');
    console.log(res.rows);
    await client.end();
}
run().catch(console.error);
