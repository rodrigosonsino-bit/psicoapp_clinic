const { Client } = require('pg');
const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  console.error('DATABASE_URL environment variable is missing.');
  process.exit(1);
}

console.log('Connecting to production DB...');

const client = new Client({
  connectionString: dbUrl,
  ssl: dbUrl.includes('postgres.railway.internal') ? undefined : { rejectUnauthorized: false }
});

async function main() {
  try {
    await client.connect();
    console.log('Connected to production DB.');

    // 1. Listar todas as tabelas
    const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;");
    console.log('\nTabelas no banco de dados de produção:');
    console.log(tables.rows.map(r => r.table_name));

    // 2. Encontrar o contato do Benj ou mensagens recentes dele
    console.log('\n--- 2. Buscando contatos relacionados a "Benj" ou mensagens ---');
    const contacts = await client.query("SELECT * FROM whatsapp_contacts WHERE name ILIKE '%benj%' OR id ILIKE '%benj%';");
    console.log('Contatos:', contacts.rows);

    // 3. Buscar as 10 últimas mensagens recebidas/enviadas na tabela de chats da IA
    console.log('\n--- 3. Últimas 10 mensagens na tabela whatsapp_ai_chats ---');
    const aiChats = await client.query("SELECT id, contact_jid, role, message_text, created_at FROM whatsapp_ai_chats ORDER BY created_at DESC LIMIT 10;");
    console.log(aiChats.rows);

    // 4. Buscar os últimos contextos de contato ativos
    console.log('\n--- 4. Últimos contextos de contatos atualizados ---');
    const contexts = await client.query("SELECT contact_jid, display_name, conversation_stage, last_interaction_at FROM whatsapp_ai_contact_contexts ORDER BY last_interaction_at DESC LIMIT 5;");
    console.log(contexts.rows);

  } catch (err) {
    console.error('Database error:', err);
  } finally {
    await client.end();
    console.log('\nDisconnected.');
  }
}

main();
