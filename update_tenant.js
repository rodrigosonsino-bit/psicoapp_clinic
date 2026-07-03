const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://neondb_owner:npg_OilvbUx97fWr@ep-curly-hill-af1mhb7g-pooler.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require' });
async function run() {
    await client.connect();
    await client.query("UPDATE tenants SET whatsapp_connected = true WHERE id = 'e4c39d63-78ca-4c5e-b1de-efd41f7c5a35'");
    console.log('Updated');
    await client.end();
}
run().catch(console.error);
