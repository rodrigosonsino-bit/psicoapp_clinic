const { Pool } = require('pg');

const dbNeon = new Pool({
  connectionString: "postgresql://neondb_owner:npg_OilvbUx97fWr@ep-curly-hill-af1mhb7g-pooler.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require"
});

async function run() {
  try {
    // 1. Buscar as últimas 10 mensagens de hoje do Rodrigo (tenant e4c39d63-78ca-4c5e-b1de-efd41f7c5a35)
    const messages = await dbNeon.query(
      `SELECT id, recipient_id, substring(content, 1, 40) as content, status, send_at, created_at, metadata
       FROM scheduled_messages 
       WHERE user_id = 'a89aa3b8-e406-44a8-8e20-4ba67c8d00c1' 
         AND created_at >= '2026-06-29T00:00:00Z'
       ORDER BY created_at DESC LIMIT 15`
    );
    console.log("=== MENSAGENS DE HOJE EM PRODUÇÃO ===");
    console.log(JSON.stringify(messages.rows, null, 2));

    // 2. Verificar se o tenant está ativo no banco
    const tenant = await dbNeon.query(
      `SELECT id, name, whatsapp_connected FROM tenants WHERE id = 'e4c39d63-78ca-4c5e-b1de-efd41f7c5a35'`
    );
    console.log("\n=== TENANT DO RODRIGO ===");
    console.log(tenant.rows);
    
    // 3. Verificar o status de autenticação salvo
    const auth = await dbNeon.query(
      `SELECT count(*) as keys_count FROM whatsapp_auth WHERE tenant_id = 'e4c39d63-78ca-4c5e-b1de-efd41f7c5a35'`
    );
    console.log("\n=== CHAVES DE AUTENTICAÇÃO SALVAS ===");
    console.log(auth.rows);

  } catch (err) {
    console.error("Erro no diagnóstico:", err.message);
  } finally {
    await dbNeon.end();
  }
}

run();
