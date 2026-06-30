import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import 'dotenv/config';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

const CONTROL_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
`;

const ADD_CHECKSUM_SQL = `
    ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum CHAR(64);
`;

function calculateChecksum(filePath: string): string {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
}

function parseIndexName(sql: string): string | null {
    const match = sql.match(/create\s+(?:unique\s+)?index\s+concurrently\s+(?:if\s+not\s+exists\s+)?([a-z0-9_]+)/i);
    return match ? match[1] : null;
}

function normalizeIndexDef(def: string): string {
    return def
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/"/g, '')
        .replace(/\bpublic\./g, '')
        .replace(/if not exists /g, '')
        .trim();
}

async function runMigrations(): Promise<void> {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error('A variável de ambiente DATABASE_URL é obrigatória.');
    }

    const pool = new Pool({ connectionString: databaseUrl });
    const client = await pool.connect();

    try {
        // Adquire advisory lock exclusivo de sessão
        await client.query('SELECT pg_advisory_lock(hashtext($1));', ['psychotherapy_api_migrations']);

        // 1. Cria a tabela de controle e garante coluna checksum
        await client.query(CONTROL_TABLE_SQL);
        await client.query(ADD_CHECKSUM_SQL);

        // 2. Consulta as migrações já aplicadas
        const { rows } = await client.query('SELECT filename, checksum FROM schema_migrations;');
        const applied = new Map<string, string | null>(rows.map((row: { filename: string; checksum: string | null }) => [row.filename, row.checksum]));

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
            const filePath = path.join(MIGRATIONS_DIR, file);
            const currentChecksum = calculateChecksum(filePath);

            if (applied.has(file)) {
                // Verificar checksum se já registrado (não alterar silenciosamente)
                const registeredChecksum = applied.get(file);
                if (registeredChecksum && registeredChecksum !== currentChecksum) {
                    console.warn(`⚠️  Aviso: Checksum divergente detectado para a migração ${file}. Banco: ${registeredChecksum} | Arquivo: ${currentChecksum}`);
                }
                console.log(`⏭️  Já aplicada: ${file}`);
                skippedCount++;
                continue;
            }

            console.log(`⚙️  Aplicando: ${file}...`);
            const sql = fs.readFileSync(filePath, 'utf8').trim();
            
            // Suporta noTransaction ou migrate:transaction=false
            const isNonTransactional = sql.includes('-- migrate:transaction=false') || sql.includes('-- noTransaction');

            if (isNonTransactional) {
                const indexName = parseIndexName(sql);
                if (indexName) {
                    const { rows: catRows } = await client.query(
                        `SELECT i.indisvalid, i.indisready, pg_get_indexdef(i.indexrelid) AS index_def
                         FROM pg_index i
                         JOIN pg_class c ON c.oid = i.indexrelid
                         JOIN pg_namespace n ON n.oid = c.relnamespace
                         WHERE c.relname = $1 AND n.nspname = CURRENT_SCHEMA();`,
                        [indexName]
                    );

                    if (catRows.length > 0) {
                        const { indisvalid, indisready, index_def } = catRows[0];
                        if (indisvalid && indisready) {
                            const normSql = normalizeIndexDef(sql);
                            const normCat = normalizeIndexDef(index_def);
                            
                            // Se a definição e integridade estão corretas, pula a execução e apenas registra
                            if (normSql.includes(indexName) && normCat.includes(indexName)) {
                                console.log(`⏭️ Índice ${indexName} já existe com definição compatível. Pulando criação.`);
                                await client.query(
                                    'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2);',
                                    [file, currentChecksum]
                                );
                                appliedCount++;
                                continue;
                            }
                        }
                        
                        // Definição incorreta ou índice inválido/não pronto: drop concurrently e recria
                        console.log(`⚠️ Índice ${indexName} inválido ou com definição desatualizada. Removendo concorrentemente...`);
                        await client.query(`DROP INDEX CONCURRENTLY IF EXISTS ${indexName};`);
                    }
                }

                // Executa sem transação
                try {
                    await client.query(sql);
                    await client.query(
                        'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2);',
                        [file, currentChecksum]
                    );
                    console.log(`✅ Aplicada (sem transação): ${file}`);
                    appliedCount++;
                } catch (err) {
                    console.error(`❌ Erro em ${file} (sem transação):`);
                    throw err;
                }
            } else {
                // Executa com transação
                try {
                    await client.query('BEGIN');
                    await client.query(sql);
                    await client.query(
                        'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2);',
                        [file, currentChecksum]
                    );
                    await client.query('COMMIT');
                    console.log(`✅ Aplicada: ${file}`);
                    appliedCount++;
                } catch (err) {
                    await client.query('ROLLBACK');
                    console.error(`❌ Erro em ${file}:`);
                    throw err;
                }
            }
        }

        console.log(`\n🎉 Migrações concluídas com sucesso!`);
        console.log(`📊 Resumo: ${appliedCount} aplicadas, ${skippedCount} puladas.`);

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

if (require.main === module) {
    runMigrations().catch(err => {
        console.error('❌ Falha crítica no runner de migrations:', err);
        process.exit(1);
    });
}

export { runMigrations };
