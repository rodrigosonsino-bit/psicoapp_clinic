const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'whatsapp_scheduler',
  password: 'secretpassword',
  port: 5432
});

async function run() {
  try {
    console.log('--- Buscando mensagens para o contato Alice (5518997067933) ---');
    const res = await pool.query(`
      SELECT id, recipient_id, substring(content, 1, 60) as content, send_at, status, created_at 
      FROM scheduled_messages 
      WHERE recipient_id LIKE '%997067933%'
      ORDER BY send_at DESC
    `);
    console.log(JSON.stringify(res.rows, null, 2));

    console.log('\n--- Buscando mensagens agendadas para HOJE (21/05/2026) ---');
    const resToday = await pool.query(`
      SELECT id, recipient_id, substring(content, 1, 60) as content, send_at, status, created_at 
      FROM scheduled_messages 
      WHERE send_at::date = '2026-05-21'::date
      ORDER BY send_at ASC
    `);
    console.log(JSON.stringify(resToday.rows, null, 2));

  } catch (err) {
    console.error('Erro na consulta:', err);
  } finally {
    await pool.end();
  }
}

run();
