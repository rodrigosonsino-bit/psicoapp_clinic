const { Pool } = require('pg');
require('dotenv').config();

async function runRefreshFamilyBackfill() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        console.error('❌ DATABASE_URL não definida.');
        process.exit(1);
    }

    const pool = new Pool({ connectionString: databaseUrl });
    const client = await pool.connect();

    try {
        console.log('🏁 Iniciando data migration: refresh_family_v1...');

        await client.query(`
            INSERT INTO data_migrations (name, status, rows_processed, started_at)
            VALUES ('refresh_family_v1', 'running', 0, NOW())
            ON CONFLICT (name) DO UPDATE SET status = 'running', started_at = NOW();
        `);

        // Atualiza tokens existentes sem family_id definindo family_id = id
        const result = await client.query(`
            UPDATE auth_refresh_tokens
            SET family_id = id
            WHERE family_id IS NULL;
        `);

        const rowsProcessed = result.rowCount;
        console.log(`   - Processados ${rowsProcessed} refresh tokens.`);

        await client.query(`
            UPDATE data_migrations
            SET status = 'completed', rows_processed = $1, completed_at = NOW(), last_error = NULL
            WHERE name = 'refresh_family_v1';
        `, [rowsProcessed]);

        console.log(`✅ Backfill de refresh token family concluído com sucesso!`);

    } catch (error) {
        console.error('❌ Erro crítico no backfill:', error.message);
        try {
            await client.query(`
                UPDATE data_migrations 
                SET status = 'failed', last_error = $1, completed_at = NOW()
                WHERE name = 'refresh_family_v1';
            `, [error.message]);
        } catch (_) {}
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

runRefreshFamilyBackfill();
