import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import 'dotenv/config';
import { encrypt } from '../infrastructure/auth/cryptoHelper';

async function migrateBackupCodes() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required.');

    const pool = new Pool({ connectionString: databaseUrl });
    const client = await pool.connect();

    try {
        console.log('🔄 Iniciando migração de segredos TOTP e backup codes para Bcrypt...');
        
        const { rows: tenants } = await client.query(`
            SELECT id, totp_secret, totp_backup_codes FROM tenants
            WHERE totp_secret IS NOT NULL OR totp_backup_codes IS NOT NULL;
        `);

        console.log(`Encontrados ${tenants.length} tenants para analisar.`);
        let migratedCount = 0;

        for (const tenant of tenants) {
            const secret = tenant.totp_secret;
            const backupCodes: string[] = tenant.totp_backup_codes ?? [];

            let needsMigration = false;
            let encryptedSecret = secret;
            let hashedBackupCodes = [...backupCodes];

            // 1. Verifica se o segredo precisa de criptografia
            if (secret && !secret.startsWith('gcm:')) {
                console.log(`Tenant ${tenant.id}: Criptografando segredo TOTP...`);
                encryptedSecret = encrypt(secret);
                needsMigration = true;
            }

            // 2. Verifica se os códigos de backup precisam de hash
            const plainCodes = backupCodes.filter(c => typeof c === 'string' && !c.startsWith('$2'));
            if (plainCodes.length > 0) {
                console.log(`Tenant ${tenant.id}: Hasheando ${plainCodes.length} backup codes...`);
                hashedBackupCodes = await Promise.all(
                    backupCodes.map(code => {
                        if (typeof code === 'string' && !code.startsWith('$2')) {
                            return bcrypt.hash(code, 12);
                        }
                        return code;
                    })
                );
                needsMigration = true;
            }

            if (needsMigration) {
                // CAS Update
                const result = await client.query(`
                    UPDATE tenants 
                    SET totp_secret = $1, totp_backup_codes = $2
                    WHERE id = $3 
                      AND (totp_secret = $4 OR ($4 IS NULL AND totp_secret IS NULL)) 
                      AND (totp_backup_codes = $5 OR ($5 IS NULL AND totp_backup_codes IS NULL));
                `, [encryptedSecret, hashedBackupCodes, tenant.id, secret, tenant.totp_backup_codes]);

                if (result.rowCount === 1) {
                    migratedCount++;
                    console.log(`✅ Tenant ${tenant.id} migrado com sucesso.`);
                } else {
                    console.warn(`⚠️ Falha de concorrência ao migrar Tenant ${tenant.id}. Pulando...`);
                }
            }
        }

        console.log(`📊 Concluído: ${migratedCount} tenants migrados.`);
    } finally {
        client.release();
        await pool.end();
    }
}

migrateBackupCodes().catch(console.error);
