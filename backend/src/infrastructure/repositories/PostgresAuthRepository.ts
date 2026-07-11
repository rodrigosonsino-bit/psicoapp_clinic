import { Pool } from 'pg';
import crypto from 'crypto';
import { injectable } from 'tsyringe';
import { IAuthRepository, TenantAuth, CreateTenantDTO, RefreshTokenRecord } from '../../domain/repositories/IAuthRepository';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@injectable()
export class PostgresAuthRepository implements IAuthRepository {
    constructor(private readonly dbPool: Pool) {}

    async findTenantByEmail(email: string): Promise<TenantAuth | null> {
        const result = await this.dbPool.query(`
            SELECT id, name, email, password_hash as "passwordHash", plan, status,
                   totp_secret as "totpSecret", totp_enabled as "totpEnabled", totp_backup_codes as "totpBackupCodes"
            FROM tenants
            WHERE email = $1;
        `, [email]);

        if (result.rows.length === 0) return null;
        return result.rows[0];
    }

    async createTenant(data: CreateTenantDTO): Promise<TenantAuth> {
        const result = await this.dbPool.query(`
            INSERT INTO tenants (name, email, password_hash, plan, status)
            VALUES ($1, $2, $3, COALESCE($4, 'starter'), COALESCE($5, 'trial'))
            RETURNING id, name, email, password_hash as "passwordHash", plan, status;
        `, [data.name, data.email, data.passwordHash, 'starter', 'trial']);

        return result.rows[0];
    }

    async findTenantById(id: string): Promise<TenantAuth | null> {
        const validId = this.validateId(id);
        const result = await this.dbPool.query(`
            SELECT id, name, email, password_hash as "passwordHash", plan, status,
                   totp_secret as "totpSecret", totp_enabled as "totpEnabled", totp_backup_codes as "totpBackupCodes"
            FROM tenants
            WHERE id = $1;
        `, [validId]);

        if (result.rows.length === 0) return null;
        return result.rows[0];
    }

    async saveRefreshToken(tenantId: string, tokenHash: string, expiresAt: Date): Promise<void> {
        const validTenantId = this.validateId(tenantId);
        const tokenId = crypto.randomUUID();
        await this.dbPool.query(`
            INSERT INTO auth_refresh_tokens (id, tenant_id, token_hash, expires_at, family_id)
            VALUES ($1, $2, $3, $4, $5);
        `, [tokenId, validTenantId, tokenHash, expiresAt, tokenId]);
    }

    async findRefreshToken(tokenHash: string): Promise<RefreshTokenRecord | null> {
        const result = await this.dbPool.query(`
            SELECT tenant_id as "tenantId", token_hash as "tokenHash", expires_at as "expiresAt", revoked_at as "revokedAt"
            FROM auth_refresh_tokens
            WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW();
        `, [tokenHash]);

        if (result.rows.length === 0) return null;
        return result.rows[0];
    }

    async revokeRefreshToken(tokenHash: string): Promise<void> {
        await this.dbPool.query(`
            UPDATE auth_refresh_tokens
            SET revoked_at = NOW()
            WHERE token_hash = $1 AND revoked_at IS NULL;
        `, [tokenHash]);
    }

    async revokeAllRefreshTokens(tenantId: string): Promise<void> {
        const validTenantId = this.validateId(tenantId);
        await this.dbPool.query(`
            UPDATE auth_refresh_tokens
            SET revoked_at = NOW()
            WHERE tenant_id = $1 AND revoked_at IS NULL;
        `, [validTenantId]);
    }

    async saveTotpSecret(tenantId: string, secret: string, backupCodes: string[]): Promise<void> {
        const validId = this.validateId(tenantId);
        await this.dbPool.query(`
            UPDATE tenants SET totp_secret = $2, totp_backup_codes = $3, totp_enabled = FALSE
            WHERE id = $1;
        `, [validId, secret, backupCodes]);
    }

    async enableTotp(tenantId: string): Promise<void> {
        const validId = this.validateId(tenantId);
        await this.dbPool.query(`UPDATE tenants SET totp_enabled = TRUE WHERE id = $1;`, [validId]);
    }

    async disableTotp(tenantId: string): Promise<void> {
        const validId = this.validateId(tenantId);
        await this.dbPool.query(`
            UPDATE tenants SET totp_enabled = FALSE, totp_secret = NULL, totp_backup_codes = NULL
            WHERE id = $1;
        `, [validId]);
    }

    async consumeBackupCode(tenantId: string, code: string): Promise<boolean> {
        const validId = this.validateId(tenantId);
        const result = await this.dbPool.query(`
            SELECT totp_backup_codes FROM tenants WHERE id = $1;
        `, [validId]);

        if (!result.rows[0]) return false;
        const codes: string[] = result.rows[0].totp_backup_codes ?? [];
        const index = codes.indexOf(code);
        if (index === -1) return false;

        codes.splice(index, 1);
        await this.dbPool.query(`
            UPDATE tenants SET totp_backup_codes = $2 WHERE id = $1;
        `, [validId, codes]);
        return true;
    }

    async save2faChallenge(challengeHash: string, tenantId: string, expiresAt: Date): Promise<void> {
        const validTenantId = this.validateId(tenantId);
        await this.dbPool.query(`
            INSERT INTO two_factor_challenges (challenge_hash, tenant_id, expires_at)
            VALUES ($1, $2, $3);
        `, [challengeHash, validTenantId, expiresAt]);
    }

    async rotateRefreshToken(
        oldTokenHash: string,
        newRefreshToken: string,
        newRefreshTokenHash: string,
        expiresAt: Date,
        newId: string
    ): Promise<{ tenantId: string; familyId: string } | null> {
        const client = await this.dbPool.connect();
        try {
            await client.query('BEGIN');

            const tokenRes = await client.query(`
                SELECT id, tenant_id as "tenantId", expires_at as "expiresAt", 
                       revoked_at as "revokedAt", family_id as "familyId"
                FROM auth_refresh_tokens
                WHERE token_hash = $1
                FOR UPDATE;
            `, [oldTokenHash]);

            if (tokenRes.rowCount !== 1) {
                await client.query('ROLLBACK');
                return null;
            }

            const currentToken = tokenRes.rows[0];
            const familyId = currentToken.familyId || currentToken.id;

            if (new Date(currentToken.expiresAt) <= new Date()) {
                await client.query('ROLLBACK');
                throw new Error('Refresh token expirado');
            }

            if (currentToken.revokedAt !== null) {
                await client.query(`
                    UPDATE auth_refresh_tokens
                    SET revoked_at = NOW()
                    WHERE family_id = $1 AND revoked_at IS NULL;
                `, [familyId]);

                await client.query('COMMIT');
                throw new Error('Token já utilizado');
            }

            await client.query(`
                UPDATE auth_refresh_tokens
                SET revoked_at = NOW()
                WHERE id = $1;
            `, [currentToken.id]);

            await client.query(`
                INSERT INTO auth_refresh_tokens (id, tenant_id, token_hash, expires_at, family_id, parent_id)
                VALUES ($1, $2, $3, $4, $5, $6);
            `, [newId, currentToken.tenantId, newRefreshTokenHash, expiresAt, familyId, currentToken.id]);

            await client.query(`
                UPDATE auth_refresh_tokens
                SET replaced_by_id = $1
                WHERE id = $2;
            `, [newId, currentToken.id]);

            await client.query('COMMIT');
            return {
                tenantId: currentToken.tenantId,
                familyId: familyId
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    // ── Helpers privados ──────────────────────────────────────────────────────

    private validateId(id: string): string {
        if (!UUID_REGEX.test(id)) {
            throw new Error(`ID inválido: "${id}". Esperado UUID v1-v5.`);
        }
        return id;
    }
}
