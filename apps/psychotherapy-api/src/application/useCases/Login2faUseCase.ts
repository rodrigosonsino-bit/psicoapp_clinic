import { injectable, inject } from 'tsyringe';
import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { verify } from 'otplib';
import { JwtService } from '../../infrastructure/auth/JwtService';
import { AppError } from '../../domain/errors/AppError';
import { decrypt } from '../../infrastructure/auth/cryptoHelper';

interface Login2faDTO {
    tempToken: string;
    token: string; // TOTP ou código de backup
    ipAddress: string;
}

interface Login2faResponse {
    accessToken: string;
    refreshToken: string;
    tenant: { id: string; name: string; email: string; plan: string };
}

@injectable()
export class Login2faUseCase {
    private readonly jwtService = new JwtService();

    constructor(
        @inject(Pool) private readonly dbPool: Pool
    ) {}

    async execute(data: Login2faDTO): Promise<Login2faResponse> {
        const { tempToken, token, ipAddress } = data;

        // 1. Valida o token temporário do desafio
        let payload: any;
        try {
            payload = this.jwtService.verifyToken(tempToken);
        } catch (e) {
            throw new AppError('Token temporário inválido ou expirado', 401);
        }

        if (!payload.twoFactorPending || payload.tokenUse !== '2fa-challenge' || !payload.jti) {
            throw new AppError('Token de desafio 2FA inválido', 401);
        }

        const tenantId = payload.tenantId;

        // 2. Rate limit check (PostgreSQL autoritativo)
        const client = await this.dbPool.connect();
        try {
            // Check IP block
            const ipBlockCheck = await client.query(`
                SELECT COUNT(*) FROM failed_totp_attempts 
                WHERE ip_address = $1 AND attempted_at >= NOW() - INTERVAL '1 minute';
            `, [ipAddress]);
            if (parseInt(ipBlockCheck.rows[0].count, 10) >= 20) {
                throw new AppError('Muitas tentativas falhas a partir deste IP. Tente novamente mais tarde.', 429);
            }

            // Check Tenant + IP block
            const tenantBlockCheck = await client.query(`
                SELECT COUNT(*) FROM failed_totp_attempts 
                WHERE tenant_id = $1 AND ip_address = $2 AND attempted_at >= NOW() - INTERVAL '1 minute';
            `, [tenantId, ipAddress]);
            if (parseInt(tenantBlockCheck.rows[0].count, 10) >= 5) {
                throw new AppError('Muitas tentativas falhas de login 2FA. Bloqueado temporariamente.', 429);
            }

            // 3. Busca dados do tenant
            const tenantRes = await client.query(`
                SELECT id, name, email, plan, totp_secret as "totpSecret", totp_backup_codes as "totpBackupCodes"
                FROM tenants WHERE id = $1;
            `, [tenantId]);

            const tenant = tenantRes.rows[0];
            if (!tenant) throw new AppError('Tenant não encontrado', 404);

            let isCodeValid = false;
            let matchingBackupHash: string | null = null;

            if (token.length === 6) {
                // Validação de TOTP comum
                if (!tenant.totpSecret) throw new AppError('2FA não configurado no tenant', 400);
                const secretDecrypted = decrypt(tenant.totpSecret);
                const otpResult = await verify({ token, secret: secretDecrypted });
                isCodeValid = otpResult.valid;
            } else if (token.length === 8) {
                // Validação de código de backup (leitor temporário dual-read)
                const backupHashes: string[] = tenant.totpBackupCodes ?? [];
                const upperToken = token.toUpperCase();
                for (const hash of backupHashes) {
                    if (hash.startsWith('$2')) {
                        const match = await bcrypt.compare(upperToken, hash);
                        if (match) {
                            isCodeValid = true;
                            matchingBackupHash = hash;
                            break;
                        }
                    } else {
                        // Plaintext legacy code support
                        if (upperToken === hash.toUpperCase()) {
                            isCodeValid = true;
                            matchingBackupHash = hash;
                            break;
                        }
                    }
                }
            }

            if (!isCodeValid) {
                // Registra tentativa falha no banco
                await client.query(`
                    INSERT INTO failed_totp_attempts (tenant_id, ip_address, attempted_at)
                    VALUES ($1, $2, NOW());
                `, [tenantId, ipAddress]);
                throw new AppError('Código 2FA ou de backup inválido', 401);
            }

            // 4. Executa consumo e autenticação em Transação Única
            await client.query('BEGIN');

            // Consome o challenge
            const challengeHash = crypto.createHash('sha256').update(payload.jti).digest('hex');
            const challengeRes = await client.query(`
                UPDATE two_factor_challenges
                SET consumed_at = NOW()
                WHERE challenge_hash = $1 AND tenant_id = $2 AND consumed_at IS NULL AND expires_at > NOW()
                RETURNING challenge_hash;
            `, [challengeHash, tenantId]);

            if (challengeRes.rowCount !== 1) {
                await client.query('ROLLBACK');
                throw new AppError('Desafio 2FA já utilizado ou expirado', 401);
            }

            // Consome o backup code se aplicável
            if (matchingBackupHash) {
                const backupRes = await client.query(`
                    UPDATE tenants
                    SET totp_backup_codes = array_remove(totp_backup_codes, $2)
                    WHERE id = $1 AND $2 = ANY(totp_backup_codes)
                    RETURNING id;
                `, [tenantId, matchingBackupHash]);

                if (backupRes.rowCount !== 1) {
                    await client.query('ROLLBACK');
                    throw new AppError('Código de backup já utilizado', 401);
                }
            }

            // Revogar refresh tokens anteriores do tenant
            await client.query(`
                UPDATE auth_refresh_tokens
                SET revoked_at = NOW()
                WHERE tenant_id = $1 AND revoked_at IS NULL;
            `, [tenantId]);

            // Cria novo refresh token
            const refreshToken = crypto.randomUUID();
            const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 30);

            await client.query(`
                INSERT INTO auth_refresh_tokens (tenant_id, token_hash, expires_at, family_id)
                VALUES ($1, $2, $3, gen_random_uuid());
            `, [tenantId, refreshTokenHash, expiresAt]);

            await client.query('COMMIT');

            // 5. Emite os tokens finais de sessão
            const accessToken = this.jwtService.generateToken({
                tenantId: tenant.id,
                email: tenant.email,
                plan: tenant.plan,
                tokenUse: 'session'
            }, '15m');

            return {
                accessToken,
                refreshToken,
                tenant: {
                    id: tenant.id,
                    name: tenant.name,
                    email: tenant.email,
                    plan: tenant.plan
                }
            };

        } catch (err) {
            if (client) {
                try {
                    const checkTx = await client.query("SELECT 1 FROM pg_catalog.pg_cursors WHERE name = 'transaction';");
                    // Se estiver em transação, roda rollback
                    await client.query('ROLLBACK');
                } catch (_) {}
            }
            throw err;
        } finally {
            client.release();
        }
    }
}
