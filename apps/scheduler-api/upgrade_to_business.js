const { Client } = require('pg');

const config = {
    user: 'postgres.ksgngclhyuhleyrzmdkt',
    host: 'aws-1-sa-east-1.pooler.supabase.com',
    database: 'postgres',
    password: 'Enter@supabase12',
    port: 6543,
    ssl: { rejectUnauthorized: false }
};

const client = new Client(config);

async function runUpgrade() {
    try {
        console.log("Conectando à base de dados de produção do Supabase...");
        await client.connect();
        console.log("✅ Conectado!");

        const query = `
            UPDATE tenants 
            SET plan = 'business', 
                status = 'active', 
                max_messages_per_month = 999999, 
                subscription_status = 'active', 
                current_period_end = '2099-12-31 23:59:59+00' 
            WHERE email = 'rodrigosonsino@gmail.com'
            RETURNING id, name, email, plan, status, max_messages_per_month, subscription_status, current_period_end;
        `;

        console.log("Atualizando o cadastro de Rodrigo Sonsino para o plano BUSINESS vitalício...");
        const result = await client.query(query);

        if (result.rows.length === 0) {
            console.log("❌ ERRO: Cadastro com o e-mail 'rodrigosonsino@gmail.com' não encontrado na base de dados de produção.");
            console.log("Por favor, certifique-se de que se cadastrou no painel do app antes de rodar o upgrade.");
        } else {
            console.log("\n🎉 PARABÉNS! Usuário promovido a Administrador Sênior com sucesso!");
            console.log("Dados atualizados na nuvem:\n", JSON.stringify(result.rows[0], null, 2));
        }

    } catch (err) {
        console.error("❌ Ocorreu um erro ao atualizar o banco de dados:", err.message);
    } finally {
        await client.end();
    }
}

runUpgrade();
