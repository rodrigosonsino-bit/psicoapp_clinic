const { Client } = require('pg');

async function run() {
    const client = new Client({ connectionString: 'postgresql://neondb_owner:npg_OilvbUx97fWr@ep-curly-hill-af1mhb7g-pooler.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require' });
    await client.connect();
    try {
        const tenantRes = await client.query('SELECT id FROM tenants LIMIT 1');
        const userId = tenantRes.rows[0].id;

        const res = await client.query(`
            INSERT INTO scheduled_messages (id, recipient_id, content, send_at, status, user_id, platform, created_at) 
            VALUES (gen_random_uuid(), '+5518996797983', 'teste12 (autonomo)', now(), 'pending', $1, 'whatsapp', now()) 
            RETURNING id
        `, [userId]);
        console.log('Inserted', res.rows[0].id);
    } catch (e) {
        console.error(e);
    } finally {
        await client.end();
    }
}
run();
