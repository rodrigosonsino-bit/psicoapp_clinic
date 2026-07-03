import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import 'dotenv/config';

const REJECTED_DIR = path.join(__dirname, '..', 'migrations', 'rejected');

function calculateChecksum(filePath: string): string {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
}

async function audit() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        console.error('❌ Erro: DATABASE_URL não definida.');
        process.exit(1);
    }

    console.log('🔍 Auditando banco de dados a partir de DATABASE_URL...');
    const pool = new Pool({ connectionString: databaseUrl });
    const client = await pool.connect();

    try {
        // 1. Listar schema_migrations
        let applied: string[] = [];
        try {
            const { rows } = await client.query('SELECT filename FROM schema_migrations ORDER BY filename ASC;');
            applied = rows.map((r: { filename: string }) => r.filename);
            console.log('📌 Migrações aplicadas no banco:');
            console.table(rows);
        } catch (err: any) {
            console.warn('⚠️  Não foi possível ler a tabela schema_migrations:', err.message);
        }

        // 2. Verificar existência de tabelas/colunas de 035-040
        const checkTables = ['calendar_events', 'two_factor_challenges', 'failed_totp_attempts', 'google_oauth_states', 'pix_webhook_inbox'];
        console.log('\n🔍 Verificando existência física das novas tabelas no schema public:');
        for (const table of checkTables) {
            const { rows } = await client.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                      AND table_name = $1
                );
            `, [table]);
            const exists = rows[0].exists;
            console.log(`   - Tabela '${table}': ${exists ? '✅ EXISTE' : '❌ NÃO EXISTE'}`);
        }

        // Verificar coluna deleted_at em psychotherapy_patients
        const { rows: colRows } = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.columns 
                WHERE table_schema = 'public' 
                  AND table_name = 'psychotherapy_patients' 
                  AND column_name = 'deleted_at'
            );
        `);
        const deletedAtExists = colRows[0].exists;
        console.log(`   - Coluna 'psychotherapy_patients.deleted_at': ${deletedAtExists ? '✅ EXISTE' : '❌ NÃO EXISTE'}`);

        // 3. Calcular Checksums dos arquivos rejeitados
        console.log('\n🧮 Checksums SHA-256 dos arquivos rejeitados (Fase 0):');
        if (fs.existsSync(REJECTED_DIR)) {
            const rejectedFiles = fs.readdirSync(REJECTED_DIR)
                .filter(f => f.endsWith('.sql'))
                .sort();
            for (const f of rejectedFiles) {
                const checksum = calculateChecksum(path.join(REJECTED_DIR, f));
                console.log(`   - ${f}: ${checksum}`);
            }
        } else {
            console.log('   - Pasta migrations/rejected não encontrada localmente.');
        }

        // 4. Detectar ambientes bloqueados (onde 035-040 foram aplicadas)
        const rejectedNames = [
            '035_add_integrity_constraints.sql',
            '036_idx_active_patient_document_concurrently.sql',
            '037_idx_active_patients_tenant_name_concurrently.sql',
            '038_refresh_tokens_family.sql',
            '039_google_oauth_states.sql',
            '040_pix_webhook_inbox.sql'
        ];

        const intersection = applied.filter(f => rejectedNames.includes(f));
        if (intersection.length > 0) {
            console.log('\n❌ BLOCKER: O ambiente atual possui migrações rejeitadas aplicadas no banco!');
            console.log('   Migrações conflitantes aplicadas:', intersection);
            console.log('   STATUS: IMPEDIDO (Rollout bloqueado para este ambiente).');
        } else {
            console.log('\n✅ STATUS: LIBERADO (Nenhuma migração rejeitada foi encontrada aplicada no banco).');
        }

    } catch (err: any) {
        console.error('❌ Erro durante a auditoria:', err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

audit();
