const { Pool } = require('pg');
const bcrypt = require('bcrypt');
require('dotenv').config();

async function test() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();
    try {
        console.log('Buscando inquilinos na base...');
        const { rows: tenants } = await client.query('SELECT id, name, email, password_hash FROM tenants LIMIT 5;');
        if (tenants.length === 0) {
            console.log('Nenhum inquilino cadastrado. Criando um para teste...');
            const passwordHash = await bcrypt.hash('mypassword123', 10);
            const insertRes = await client.query(`
                INSERT INTO tenants (id, name, email, password_hash, plan, status)
                VALUES (gen_random_uuid(), 'Test User', 'test@example.com', $1, 'starter', 'trial')
                RETURNING id, name, email;
            `, [passwordHash]);
            console.log('Inquilino de teste criado:', insertRes.rows[0]);
            tenants.push({
                id: insertRes.rows[0].id,
                email: 'test@example.com',
                passwordHash
            });
        }

        const tenant = tenants[0];
        console.log(`Tentando fazer login como: ${tenant.email}`);

        // Simula o login use case
        const email = tenant.email.trim().toLowerCase();
        // Vamos buscar no repositório
        const res = await client.query(`
            SELECT id, name, email, password_hash as "passwordHash", plan, status,
                   totp_secret as "totpSecret", totp_enabled as "totpEnabled", totp_backup_codes as "totpBackupCodes"
            FROM tenants
            WHERE email = $1;
        `, [email]);

        const dbTenant = res.rows[0];
        const match = await bcrypt.compare('mypassword123', dbTenant.passwordHash).catch(() => false) 
                      || await bcrypt.compare('admin123', dbTenant.passwordHash).catch(() => false);
        
        console.log('Credenciais batem?', match);

        // Limpar refresh tokens anteriores
        await client.query(`
            UPDATE auth_refresh_tokens
            SET revoked_at = NOW()
            WHERE tenant_id = $1 AND revoked_at IS NULL;
        `, [dbTenant.id]);

        // Gerar novo refresh token
        const tokenId = require('crypto').randomUUID();
        const tokenHash = 'some-dummy-sha256-hash';
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        await client.query(`
            INSERT INTO auth_refresh_tokens (id, tenant_id, token_hash, expires_at, family_id)
            VALUES ($1, $2, $3, $4, $5);
        `, [tokenId, dbTenant.id, tokenHash, expiresAt, tokenId]);

        console.log('Login simulado com sucesso!');
    } catch (err) {
        console.error('❌ ERRO NO LOGIN:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

test();
