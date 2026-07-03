const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://neondb_owner:npg_OilvbUx97fWr@ep-curly-hill-af1mhb7g-pooler.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require' });

async function run() {
    await client.connect();
    try {
        const res = await client.query(`SELECT id, status, send_at, platform FROM scheduled_messages WHERE content LIKE '%Antigravity%' ORDER BY created_at DESC LIMIT 1`);
        console.log(res.rows);
    } catch (e) {
        console.error(e);
    }
    await client.end();
}

run();
