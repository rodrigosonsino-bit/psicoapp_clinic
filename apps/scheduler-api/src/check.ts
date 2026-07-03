import { Client } from 'pg';
const client = new Client({ connectionString: 'postgresql://neondb_owner:npg_OilvbUx97fWr@ep-curly-hill-af1mhb7g-pooler.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require' });
async function run() {
    await client.connect();
    const res = await client.query("UPDATE scheduled_messages SET status = 'failed' WHERE status = 'pending' AND send_at < NOW() RETURNING id, send_at, status;");
    console.table(res.rows);
    await client.end();
}
run().catch(console.error);
