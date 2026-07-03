const { Client } = require('pg');

async function run() {
    const client = new Client({ connectionString: 'postgresql://neondb_owner:npg_OilvbUx97fWr@ep-curly-hill-af1mhb7g-pooler.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require' });
    await client.connect();
    try {
        const res = await client.query("SELECT content, status FROM scheduled_messages WHERE id = 'f4a82683-acbb-426a-8faa-ffabbf02c322'");
        console.table(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await client.end();
    }
}
run();
