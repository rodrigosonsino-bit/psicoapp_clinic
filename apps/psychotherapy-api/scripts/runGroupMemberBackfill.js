const { Pool } = require('pg');
require('dotenv').config();

async function runGroupMemberBackfill() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        console.error('❌ DATABASE_URL não definida.');
        process.exit(1);
    }

    const pool = new Pool({ connectionString: databaseUrl });
    const client = await pool.connect();

    try {
        console.log('🏁 Iniciando data migration: group_members_v1...');

        await client.query(`
            INSERT INTO data_migrations (name, status, rows_processed, started_at)
            VALUES ('group_members_v1', 'running', 0, NOW())
            ON CONFLICT (name) DO UPDATE SET status = 'running', started_at = NOW();
        `);

        let totalProcessed = 0;
        let hasMore = true;

        while (hasMore) {
            const { rows: batch } = await client.query(`
                SELECT group_id, patient_id FROM therapy_group_members
                WHERE tenant_id IS NULL
                LIMIT 100;
            `);

            if (batch.length === 0) {
                hasMore = false;
                break;
            }

            await client.query('BEGIN');
            try {
                for (const member of batch) {
                    // Buscar tenant do paciente
                    const patRes = await client.query('SELECT tenant_id FROM psychotherapy_patients WHERE id = $1;', [member.patient_id]);
                    // Buscar tenant do grupo
                    const grpRes = await client.query('SELECT tenant_id FROM therapy_groups WHERE id = $1;', [member.group_id]);

                    if (patRes.rowCount === 0 || grpRes.rowCount === 0) {
                        throw new Error(`Integridade quebrada: paciente ou grupo não encontrado para o vínculo (${member.group_id}, ${member.patient_id}).`);
                    }

                    const patientTenant = patRes.rows[0].tenant_id;
                    const groupTenant = grpRes.rows[0].tenant_id;

                    if (patientTenant !== groupTenant) {
                        throw new Error(`Divergência cross-tenant: Paciente tenant '${patientTenant}' e Grupo tenant '${groupTenant}' são diferentes!`);
                    }

                    await client.query(`
                        UPDATE therapy_group_members
                        SET tenant_id = $1
                        WHERE group_id = $2 AND patient_id = $3;
                    `, [patientTenant, member.group_id, member.patient_id]);
                }

                totalProcessed += batch.length;
                
                await client.query(`
                    UPDATE data_migrations
                    SET rows_processed = $1
                    WHERE name = 'group_members_v1';
                `, [totalProcessed]);

                await client.query('COMMIT');
                console.log(`   - Processados ${totalProcessed} membros de grupo...`);
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            }
        }

        await client.query(`
            UPDATE data_migrations
            SET status = 'completed', completed_at = NOW(), last_error = NULL
            WHERE name = 'group_members_v1';
        `);

        console.log(`✅ Backfill de membros de grupo concluído com sucesso! ${totalProcessed} registros migrados.`);

    } catch (error) {
        console.error('❌ Erro crítico no backfill:', error.message);
        try {
            await client.query(`
                UPDATE data_migrations 
                SET status = 'failed', last_error = $1, completed_at = NOW()
                WHERE name = 'group_members_v1';
            `, [error.message]);
        } catch (_) {}
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

runGroupMemberBackfill();
