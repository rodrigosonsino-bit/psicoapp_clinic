import { Pool } from 'pg';
import { GoogleOAuthTokens } from '../../domain/repositories/IPsychotherapyRepository';
import { encrypt, decrypt } from '../auth/cryptoHelper';
import { validateTenantId } from './shared';

/**
 * Extraído de PostgresPsychotherapyRepository (os 4 métodos de Google OAuth tokens,
 * classificados como FOLHA — CRUD de tabela única `google_oauth_tokens`, sem transação, sem
 * side effect cross-domain) sem alterar nenhuma linha de lógica. Ver
 * .claude/plans/pendencias-tecnicas-pos-quitacao-2026-07.md (item 1) e
 * .claude/plans/classificacao-postgres-psychotherapy-repository.md.
 */
export class PostgresGoogleOAuthRepository {
    constructor(private readonly dbPool: Pool) {}

    async saveGoogleOAuthTokens(tenantId: string, accessToken: string, refreshToken: string, expiryDate: number, calendarId?: string): Promise<void> {
        const validTenantId = validateTenantId(tenantId);
        const encryptedAccessToken = encrypt(accessToken);
        const encryptedRefreshToken = encrypt(refreshToken);
        await this.dbPool.query(`
            INSERT INTO google_oauth_tokens (tenant_id, access_token, refresh_token, expiry_date, calendar_id)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (tenant_id) DO UPDATE SET
                access_token = EXCLUDED.access_token,
                refresh_token = EXCLUDED.refresh_token,
                expiry_date = EXCLUDED.expiry_date,
                calendar_id = COALESCE($5, google_oauth_tokens.calendar_id),
                updated_at = NOW();
        `, [validTenantId, encryptedAccessToken, encryptedRefreshToken, expiryDate, calendarId ?? null]);
    }

    async getGoogleOAuthTokens(tenantId: string): Promise<GoogleOAuthTokens | null> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT tenant_id, access_token, refresh_token, expiry_date, calendar_id
            FROM google_oauth_tokens WHERE tenant_id = $1;
        `, [validTenantId]);
        if (!result.rows[0]) return null;
        const row = result.rows[0];
        return {
            tenantId: row.tenant_id,
            accessToken: decrypt(row.access_token),
            refreshToken: decrypt(row.refresh_token),
            expiryDate: row.expiry_date ? Number(row.expiry_date) : null,
            calendarId: row.calendar_id
        };
    }

    async updateGoogleAccessToken(tenantId: string, accessToken: string, expiryDate: number): Promise<void> {
        const validTenantId = validateTenantId(tenantId);
        const encryptedAccessToken = encrypt(accessToken);
        await this.dbPool.query(`
            UPDATE google_oauth_tokens SET access_token = $2, expiry_date = $3, updated_at = NOW()
            WHERE tenant_id = $1;
        `, [validTenantId, encryptedAccessToken, expiryDate]);
    }

    async listAllGoogleOAuthTokens(): Promise<GoogleOAuthTokens[]> {
        const result = await this.dbPool.query(`
            SELECT tenant_id, access_token, refresh_token, expiry_date, calendar_id
            FROM google_oauth_tokens
            WHERE refresh_token IS NOT NULL AND calendar_id IS NOT NULL;
        `);
        return result.rows.map(row => ({
            tenantId: row.tenant_id,
            accessToken: decrypt(row.access_token),
            refreshToken: decrypt(row.refresh_token),
            expiryDate: row.expiry_date ? Number(row.expiry_date) : null,
            calendarId: row.calendar_id
        }));
    }
}
