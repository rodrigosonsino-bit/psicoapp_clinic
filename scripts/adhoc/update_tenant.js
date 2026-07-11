const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });
async function run() {
    await client.connect();
    await client.query("UPDATE tenants SET whatsapp_connected = true WHERE id = 'e4c39d63-78ca-4c5e-b1de-efd41f7c5a35'");
    console.log('Updated');
    await client.end();
}
run().catch(console.error);
