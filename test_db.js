const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://neondb_owner:npg_OilvbUx97fWr@ep-curly-hill-af1mhb7g-pooler.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require' });

async function run() {
    await client.connect();
    // Inserir mensagem de teste
    const userId = 'e4c39d63-78ca-4c5e-b1de-efd41f7c5a35'; // Rodrigo Sonsino
    const sendAt = new Date(Date.now() + 10000); // Daqui 10 segundos
    const text = 'Teste autônomo enviado diretamente via banco (Antigravity)';

    try {
        const res = await client.query(
            `INSERT INTO scheduled_messages (id, user_id, recipient_id, content, status, send_at, platform) 
             VALUES (gen_random_uuid(), $1, '5518996153762', $2, 'pending', $3, 'whatsapp')
             RETURNING id`,
            [userId, text, sendAt]
        );
        console.log(`Mensagem agendada! ID: ${res.rows[0].id}`);
        console.log(`Horário programado: ${sendAt.toISOString()}`);
    } catch (e) {
        console.error(e);
    }
    await client.end();
}

run();
