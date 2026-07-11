import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

const DOWN_MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations', 'down');

async function runRollback(): Promise<void> {
    const filename = process.argv[2];
    if (!filename) {
        console.error('❌ Uso: npm run rollback <nome_do_arquivo_da_migration.sql>');
        process.exit(1);
    }

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error('A variável de ambiente DATABASE_URL é obrigatória.');
    }

    const pool = new Pool({ connectionString: databaseUrl });
    const client = await pool.connect();

    try {
        // Adquire advisory lock exclusivo de sessão
        await client.query('SELECT pg_advisory_lock(hashtext($1));', ['psychotherapy_api_migrations']);

        // Verifica se a migração está registrada como aplicada
        const { rows } = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1;', [filename]);
        if (rows.length === 0) {
            console.log(`⚠️  A migração ${filename} não está registrada como aplicada no banco.`);
            return;
        }

        const filePath = path.join(DOWN_MIGRATIONS_DIR, filename);
        if (!fs.existsSync(filePath)) {
            throw new Error(`Arquivo de rollback não encontrado: ${filePath}`);
        }

        console.log(`⚙️  Executando rollback de: ${filename}...`);
        const sql = fs.readFileSync(filePath, 'utf8').trim();
        const lines = sql.split('\n');
        const isNonTransactional = lines[0]?.trim() === '-- migrate:transaction=false';

        if (isNonTransactional) {
            try {
                await client.query(sql);
                await client.query('DELETE FROM schema_migrations WHERE filename = $1;', [filename]);
                console.log(`✅ Rollback concluído (sem transação): ${filename}`);
            } catch (err) {
                console.error(`❌ Erro no rollback de ${filename} (sem transação):`);
                throw err;
            }
        } else {
            try {
                await client.query('BEGIN');
                await client.query(sql);
                await client.query('DELETE FROM schema_migrations WHERE filename = $1;', [filename]);
                await client.query('COMMIT');
                console.log(`✅ Rollback concluído: ${filename}`);
            } catch (err) {
                await client.query('ROLLBACK');
                console.error(`❌ Erro no rollback de ${filename}:`);
                throw err;
            }
        }

    } finally {
        try {
            await client.query('SELECT pg_advisory_unlock(hashtext($1));', ['psychotherapy_api_migrations']);
        } catch (e) {
            console.error('Erro ao liberar advisory lock:', e);
        }
        client.release();
        await pool.end();
    }
}

runRollback().catch(err => {
    console.error('❌ Falha crítica no runner de rollback:', err);
    process.exit(1);
});
