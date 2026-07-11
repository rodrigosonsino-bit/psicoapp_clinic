import { Pool } from 'pg';
import 'dotenv/config';

async function runPreflights() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error('DATABASE_URL is required in env.');
    }

    console.log('🔍 Iniciando Preflight Checks (Fase 0)...');
    const pool = new Pool({ connectionString: databaseUrl });
    const client = await pool.connect();

    try {
        let hasInconsistencies = false;

        // 0. Verifica se a coluna deleted_at existe na tabela de pacientes
        const { rows: colCheck } = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'psychotherapy_patients' AND column_name = 'deleted_at';
        `);
        const hasDeletedAt = colCheck.length > 0;

        // 1. Check cross-tenant references
        const crossChecks = [
            {
                name: 'sessions -> patients',
                sql: `SELECT s.id, s.tenant_id as child_tenant, p.tenant_id as parent_tenant 
                      FROM psychotherapy_sessions s 
                      JOIN psychotherapy_patients p ON s.patient_id = p.id 
                      WHERE s.tenant_id <> p.tenant_id;`
            },
            {
                name: 'receipts -> patients',
                sql: `SELECT r.id, r.tenant_id as child_tenant, p.tenant_id as parent_tenant 
                      FROM psychotherapy_receipts r 
                      JOIN psychotherapy_patients p ON r.patient_id = p.id 
                      WHERE r.tenant_id <> p.tenant_id;`
            },
            {
                name: 'appointments -> patients',
                sql: `SELECT a.id, a.tenant_id as child_tenant, p.tenant_id as parent_tenant 
                      FROM psychotherapy_appointments a 
                      JOIN psychotherapy_patients p ON a.patient_id = p.id 
                      WHERE a.tenant_id <> p.tenant_id;`
            },
            {
                name: 'clinical_notes -> patients',
                sql: `SELECT n.id, n.tenant_id as child_tenant, p.tenant_id as parent_tenant 
                      FROM psychotherapy_clinical_notes n 
                      JOIN psychotherapy_patients p ON n.patient_id = p.id 
                      WHERE n.tenant_id <> p.tenant_id;`
            },
            {
                name: 'clinical_notes -> sessions',
                sql: `SELECT n.id, n.tenant_id as child_tenant, s.tenant_id as parent_tenant 
                      FROM psychotherapy_clinical_notes n 
                      JOIN psychotherapy_sessions s ON n.session_id = s.id 
                      WHERE n.tenant_id <> s.tenant_id;`
            },
            {
                name: 'pix_charges -> patients',
                sql: `SELECT c.id, c.tenant_id as child_tenant, p.tenant_id as parent_tenant 
                      FROM psychotherapy_pix_charges c 
                      JOIN psychotherapy_patients p ON c.patient_id = p.id 
                      WHERE c.tenant_id <> p.tenant_id;`
            },
            {
                name: 'monthly_records -> patients',
                sql: `SELECT m.id, m.tenant_id as child_tenant, p.tenant_id as parent_tenant 
                      FROM psychotherapy_monthly_records m 
                      JOIN psychotherapy_patients p ON m.patient_id = p.id 
                      WHERE m.tenant_id <> p.tenant_id;`
            },
            {
                name: 'anamnesis -> patients',
                sql: `SELECT a.id, a.tenant_id as child_tenant, p.tenant_id as parent_tenant 
                      FROM psychotherapy_anamnesis a 
                      JOIN psychotherapy_patients p ON a.patient_id = p.id 
                      WHERE a.tenant_id <> p.tenant_id;`
            },
            {
                name: 'treatment_plans -> patients',
                sql: `SELECT t.id, t.tenant_id as child_tenant, p.tenant_id as parent_tenant 
                      FROM psychotherapy_treatment_plans t 
                      JOIN psychotherapy_patients p ON t.patient_id = p.id 
                      WHERE t.tenant_id <> p.tenant_id;`
            },
            {
                name: 'group_payments -> patients',
                sql: `SELECT gp.id, gp.tenant_id as child_tenant, p.tenant_id as parent_tenant 
                      FROM group_payments gp 
                      JOIN psychotherapy_patients p ON gp.patient_id = p.id 
                      WHERE gp.tenant_id <> p.tenant_id;`
            },
            {
                name: 'group_session_records -> patients',
                sql: `SELECT gsr.id, gsr.tenant_id as child_tenant, p.tenant_id as parent_tenant 
                      FROM group_session_records gsr 
                      JOIN psychotherapy_patients p ON gsr.patient_id = p.id 
                      WHERE gsr.tenant_id <> p.tenant_id;`
            },
            {
                name: 'booking_links -> patients',
                sql: `SELECT bl.id, bl.tenant_id as child_tenant, p.tenant_id as parent_tenant 
                      FROM psychotherapy_booking_links bl 
                      JOIN psychotherapy_patients p ON bl.patient_id = p.id 
                      WHERE bl.tenant_id <> p.tenant_id;`
            },
            {
                name: 'therapy_group_members -> groups & patients',
                sql: `SELECT gm.group_id, g.tenant_id as group_tenant, p.tenant_id as patient_tenant 
                      FROM therapy_group_members gm 
                      JOIN therapy_groups g ON gm.group_id = g.id 
                      JOIN psychotherapy_patients p ON gm.patient_id = p.id 
                      WHERE g.tenant_id <> p.tenant_id;`
            }
        ];

        console.log('\n--- 1. Checagem de Relações Cross-Tenant ---');
        for (const check of crossChecks) {
            try {
                const { rows } = await client.query(check.sql);
                if (rows.length > 0) {
                    console.error(`❌ INCONSISTÊNCIA DETECTADA EM ${check.name}: ${rows.length} registros inválidos.`);
                    console.error(JSON.stringify(rows.slice(0, 5), null, 2));
                    hasInconsistencies = true;
                } else {
                    console.log(`✅ ${check.name}: Sem inconsistências.`);
                }
            } catch (e: any) {
                console.warn(`⚠️  Tabela ou coluna ausente para check ${check.name}: ${e.message}`);
            }
        }

        // 2. Check CPF duplicado (document)
        console.log('\n--- 2. Checagem de CPF (Documento) Duplicado ---');
        const filterDeleted = hasDeletedAt ? 'AND deleted_at IS NULL' : '';
        const docDupSql = `
            SELECT tenant_id, regexp_replace(document, '[^0-9]', '', 'g') as doc_clean, COUNT(*) 
            FROM psychotherapy_patients 
            WHERE document IS NOT NULL AND regexp_replace(document, '[^0-9]', '', 'g') <> '' ${filterDeleted}
            GROUP BY tenant_id, regexp_replace(document, '[^0-9]', '', 'g') 
            HAVING COUNT(*) > 1;
        `;
        const { rows: docDups } = await client.query(docDupSql);
        if (docDups.length > 0) {
            console.error(`❌ CPF DUPLICADO ENCONTRADO: ${docDups.length} documentos duplicados ativos.`);
            console.error(JSON.stringify(docDups, null, 2));
            hasInconsistencies = true;
        } else {
            console.log('✅ CPF (Documento): Sem duplicidades de CPFs ativos.');
        }

        // 3. Appointments sobrepostos (Double booking)
        console.log('\n--- 3. Checagem de Appointments Sobrepostos ---');
        const overlapSql = `
            SELECT a1.id as id1, a2.id as id2, a1.tenant_id, a1.scheduled_at, a1.duration_minutes
            FROM psychotherapy_appointments a1
            JOIN psychotherapy_appointments a2 ON a1.tenant_id = a2.tenant_id AND a1.id < a2.id
            WHERE a1.status IN ('scheduled', 'confirmed')
              AND a2.status IN ('scheduled', 'confirmed')
              AND a1.group_id IS NULL AND a2.group_id IS NULL
              AND (
                (a1.scheduled_at, a1.scheduled_at + a1.duration_minutes * interval '1 minute') OVERLAPS
                (a2.scheduled_at, a2.scheduled_at + a2.duration_minutes * interval '1 minute')
              );
        `;
        try {
            const { rows: overlaps } = await client.query(overlapSql);
            if (overlaps.length > 0) {
                console.error(`❌ APPOINTMENTS SOBREPOSTOS ENCONTRADOS: ${overlaps.length} colisões.`);
                console.error(JSON.stringify(overlaps.slice(0, 5), null, 2));
                hasInconsistencies = true;
            } else {
                console.log('✅ Appointments: Sem sobreposição de consultas individuais.');
            }
        } catch (e: any) {
            console.warn(`⚠️  Tabela ou colunas de appointments ausentes: ${e.message}`);
        }

        // 4. scheduled_messages.user_id que não seja UUID
        console.log('\n--- 4. Checagem de scheduled_messages.user_id (não UUID) ---');
        const uuidCheckSql = `
            SELECT id, user_id FROM scheduled_messages 
            WHERE user_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
        `;
        try {
            const { rows: nonUuids } = await client.query(uuidCheckSql);
            if (nonUuids.length > 0) {
                console.error(`❌ USER_ID INVÁLIDO (NÃO-UUID) ENCONTRADO: ${nonUuids.length} registros.`);
                console.error(JSON.stringify(nonUuids.slice(0, 5), null, 2));
                hasInconsistencies = true;
            } else {
                console.log('✅ Scheduled Messages: Todos os user_id são UUIDs válidos.');
            }
        } catch (e: any) {
            console.warn(`⚠️  Tabela scheduled_messages ausente ou inalcançável: ${e.message}`);
        }

        // 5. Backup codes já hashados ou inválidos
        console.log('\n--- 5. Checagem de Backup Codes ---');
        const backupCheckSql = `
            SELECT id, name, email, totp_backup_codes FROM tenants;
        `;
        const { rows: tenants } = await client.query(backupCheckSql);
        let plainTextBackupCount = 0;
        for (const tenant of tenants) {
            const codes = tenant.totp_backup_codes;
            if (Array.isArray(codes)) {
                const plainCodes = codes.filter(c => typeof c === 'string' && !c.startsWith('$2'));
                if (plainCodes.length > 0) {
                    plainTextBackupCount += plainCodes.length;
                }
            }
        }
        if (plainTextBackupCount > 0) {
            console.warn(`⚠️  DIFERENÇA DETECTADA: ${plainTextBackupCount} backup codes estão em texto puro (serão migrados na Fase 2).`);
        } else {
            console.log('✅ Backup Codes: Todos estão devidamente hashados com bcrypt ou vazios.');
        }

        // 6. Tokens OAuth e segredos TOTP existentes
        console.log('\n--- 6. Checagem de TOTP / OAuth Criptografia ---');
        const { rows: totpSecrets } = await client.query('SELECT COUNT(*) FROM tenants WHERE totp_secret IS NOT NULL;');
        console.log(`ℹ️  Segredos TOTP existentes: ${totpSecrets[0].count}`);

        try {
            const { rows: oauthTokens } = await client.query('SELECT COUNT(*) FROM google_oauth_tokens;');
            console.log(`ℹ️  Tokens Google OAuth existentes: ${oauthTokens[0].count}`);
        } catch (e: any) {
            console.warn(`⚠️  Tabela google_oauth_tokens ausente: ${e.message}`);
        }

        console.log('\n-------------------------------------------');
        if (hasInconsistencies) {
            console.error('❌ STATUS: REPROVADO. Corrija as inconsistências listadas acima.');
            process.exit(1);
        } else {
            console.log('🎉 STATUS: APROVADO. Nenhum impeditivo encontrado para rollout da Fase 0!');
        }

    } finally {
        client.release();
        await pool.end();
    }
}

runPreflights().catch(err => {
    console.error('Falha crítica nos preflight checks:', err);
    process.exit(1);
});
