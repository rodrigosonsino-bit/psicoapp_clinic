const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Configuração separada para evitar erros de parsing na URI
const config = {
    user: 'postgres.ksgngclhyuhleyrzmdkt',
    host: 'aws-1-sa-east-1.pooler.supabase.com',
    database: 'postgres',
    password: 'Enter@supabase12',
    port: 6543,
    ssl: { rejectUnauthorized: false }
};

const client = new Client(config);

async function runSchema() {
    try {
        console.log("Tentando conectar ao Supabase (Pooler IPv4)...");
        await client.connect();
        console.log("✅ Conectado ao Supabase!");
        
        const schemaPath = path.join(__dirname, 'src', 'infrastructure', 'database', 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        
        console.log("Executando schema.sql...");
        await client.query(schema);
        console.log("🚀 Tabelas criadas com sucesso no Supabase!");
        
    } catch (err) {
        console.error("❌ Erro de Conexão:", err.message);
        if (err.message.includes('authentication failed')) {
            console.log("\nDICA: Verifique se a senha 'Enter@supabase12' está correta no painel do Supabase.");
        }
    } finally {
        await client.end();
    }
}

runSchema();
