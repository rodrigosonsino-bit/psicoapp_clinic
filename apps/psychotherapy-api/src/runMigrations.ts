import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

const CONTROL_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
`;

async function runMigrations(): Promise<void> {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error('A variável de ambiente DATABASE_URL é obrigatória.');
    }

    const pool = new Pool({ connectionString: databaseUrl });
    const client = await pool.connect();

    try {
        // 1. Cria a tabela de controle se não existir
        await client.query(CONTROL_TABLE_SQL);

        // 2. Consulta as migrações já aplicadas
        const { rows } = await client.query('SELECT filename FROM schema_migrations;');
        const applied = new Set<string>(rows.map((row: { filename: string }) => row.filename));

        // 3. Lê os arquivos da pasta migrations/
        if (!fs.existsSync(MIGRATIONS_DIR)) {
            throw new Error(`Pasta de migrations não encontrada: ${MIGRATIONS_DIR}`);
        }

        const files = fs.readdirSync(MIGRATIONS_DIR)
            .filter(file => file.endsWith('.sql'))
            .sort();

        let appliedCount = 0;
        let skippedCount = 0;

        for (const file of files) {
            if (applied.has(file)) {
                console.log(`⏭️  Já aplicada: ${file}`);
                skippedCount++;
                continue;
            }

            console.log(`⚙️  Aplicando: ${file}...`);
            const filePath = path.join(MIGRATIONS_DIR, file);
            const sql = fs.readFileSync(filePath, 'utf8');

            try {
                await client.query('BEGIN');
                await client.query(sql);
                await client.query('INSERT INTO schema_migrations (filename) VALUES ($1);', [file]);
                await client.query('COMMIT');
                console.log(`✅ Aplicada: ${file}`);
                appliedCount++;
            } catch (err) {
                await client.query('ROLLBACK');
                console.error(`❌ Erro em ${file}:`);
                throw err; // relança para parar a execução
            }
        }

        console.log(`\n🎉 Migrações concluídas com sucesso!`);
        console.log(`📊 Resumo: ${appliedCount} aplicadas, ${skippedCount} puladas.`);

    } finally {
        client.release();
        await pool.end();
    }
}

runMigrations().catch(err => {
    console.error('❌ Falha crítica no runner de migrations:', err);
    process.exit(1);
});
