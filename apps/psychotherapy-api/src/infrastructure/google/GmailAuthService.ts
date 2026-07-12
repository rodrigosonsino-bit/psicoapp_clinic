import crypto from 'crypto';
import { google } from 'googleapis';
import { injectable, inject } from 'tsyringe';
import { Pool } from 'pg';
import { encrypt, decrypt } from '../auth/cryptoHelper';
import { logger } from '../logger';

// Usa o OAuth2Client embutido no googleapis para evitar conflito de versões
// com google-auth-library — mesmo padrão do GoogleCalendarService.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OAuth2Client = any;

const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const STATE_TTL_MINUTES = 10;

export interface GmailConnectionStatus {
    connected: boolean;
    emailAddress: string | null;
}

/**
 * Conexão OAuth do Gmail — separada e dedicada da conexão do Google Calendar
 * (GoogleCalendarService/google_oauth_tokens). Ver
 * docs/email-bank-statement-ingestion-plan.md, seção "Decisão de
 * arquitetura: Gmail API, conexão OAuth dedicada". Não reaproveita nenhuma
 * infra de token/state do Calendar — só a função de cifra (cryptoHelper.ts).
 *
 * Diferente do padrão pré-existente do Calendar (GoogleAuthController usa o
 * state da URL como tenantId, sem validação — CSRF de OAuth, achado
 * sinalizado como tarefa separada, fora deste plano), este fluxo usa um
 * state aleatório real, armazenado hasheado em gmail_oauth_states, com
 * expiração e consumo único atômico.
 */
@injectable()
export class GmailAuthService {
    private readonly clientId: string;
    private readonly clientSecret: string;
    private readonly redirectUri: string;

    constructor(@inject(Pool) private readonly dbPool: Pool) {
        this.clientId = process.env.GOOGLE_CLIENT_ID ?? '';
        this.clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
        this.redirectUri = process.env.GMAIL_REDIRECT_URI ?? 'http://localhost:3333/auth/gmail/callback';
    }

    createOAuth2Client(): OAuth2Client {
        return new google.auth.OAuth2(this.clientId, this.clientSecret, this.redirectUri);
    }

    /**
     * Gera a URL de consentimento com um `state` aleatório real (32 bytes),
     * gravando `sha256(token)` + `tenant_id` + `expires_at` em
     * `gmail_oauth_states`. `access_type: 'offline'` + `prompt: 'consent'`
     * garantem que o Google emita `refresh_token` mesmo em reconexão
     * (ressalva da 8ª rodada de auditoria — sem isso, o polling sem
     * interação do usuário para de funcionar silenciosamente quando o
     * access token expira).
     */
    async getAuthorizationUrl(tenantId: string): Promise<string> {
        const token = crypto.randomBytes(32).toString('hex');
        const stateHash = crypto.createHash('sha256').update(token).digest('hex');

        await this.dbPool.query(
            `INSERT INTO gmail_oauth_states (state_hash, tenant_id, expires_at)
             VALUES ($1, $2, NOW() + INTERVAL '${STATE_TTL_MINUTES} minutes')`,
            [stateHash, tenantId]
        );

        const oauth2Client = this.createOAuth2Client();
        return oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: [GMAIL_READONLY_SCOPE],
            state: token,
            prompt: 'consent',
        });
    }

    /**
     * Valida o `state` recebido no callback: busca por `sha256(state)`,
     * exige `expires_at > NOW() AND consumed_at IS NULL`, marca
     * `consumed_at=NOW()` na mesma operação atômica (`UPDATE ... RETURNING`
     * — nunca ler depois escrever em passos separados, contra replay).
     * Lança erro explícito se inválido/expirado/já consumido — nunca
     * assume um tenant.
     */
    private async consumeState(state: string): Promise<string> {
        const stateHash = crypto.createHash('sha256').update(state).digest('hex');

        const result = await this.dbPool.query<{ tenant_id: string }>(
            `UPDATE gmail_oauth_states
             SET consumed_at = NOW()
             WHERE state_hash = $1 AND expires_at > NOW() AND consumed_at IS NULL
             RETURNING tenant_id`,
            [stateHash]
        );

        const tenantId = result.rows[0]?.tenant_id;
        if (!tenantId) {
            throw new Error('State OAuth do Gmail inválido, expirado ou já utilizado.');
        }
        return tenantId;
    }

    /**
     * Troca o code pelo tenantId (validado via consumeState) + tokens, exige
     * refresh_token de verdade (nunca salva token parcial), busca o
     * endereço da conta conectada, e persiste cifrado via cryptoHelper.ts.
     */
    async handleCallback(code: string, state: string): Promise<{ tenantId: string }> {
        const tenantId = await this.consumeState(state);

        const oauth2Client = this.createOAuth2Client();
        const { tokens } = await oauth2Client.getToken(code);

        if (!tokens.access_token || !tokens.refresh_token) {
            throw new Error(
                'Google não retornou refresh_token válido para o Gmail. Desconecte e reconecte do zero.'
            );
        }

        oauth2Client.setCredentials(tokens);
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        const profile = await gmail.users.getProfile({ userId: 'me' });
        const emailAddress = profile.data.emailAddress ?? '';

        const expiryDate = tokens.expiry_date ?? Date.now() + 3600_000;
        await this.dbPool.query(
            `INSERT INTO gmail_oauth_tokens
                (tenant_id, encrypted_access_token, encrypted_refresh_token, expiry_date, email_address, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (tenant_id) DO UPDATE SET
                encrypted_access_token = EXCLUDED.encrypted_access_token,
                encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
                expiry_date = EXCLUDED.expiry_date,
                email_address = EXCLUDED.email_address,
                updated_at = NOW()`,
            [tenantId, encrypt(tokens.access_token), encrypt(tokens.refresh_token), expiryDate, emailAddress]
        );

        logger.info({ tenantId, emailAddress }, '✅ Gmail (extrato bancário) conectado com sucesso');
        return { tenantId };
    }

    async getStatus(tenantId: string): Promise<GmailConnectionStatus> {
        const result = await this.dbPool.query<{ email_address: string }>(
            `SELECT email_address FROM gmail_oauth_tokens WHERE tenant_id = $1`,
            [tenantId]
        );
        const row = result.rows[0];
        return { connected: !!row, emailAddress: row?.email_address ?? null };
    }

    /**
     * Cliente autenticado com auto-renovação: se o access token estiver
     * expirado, o googleapis renova via refresh_token automaticamente e
     * dispara o listener 'tokens', que persiste o novo access token cifrado
     * de volta em gmail_oauth_tokens antes de qualquer chamada usar o
     * client (ressalva da 8ª rodada de auditoria).
     */
    async getAuthenticatedClient(tenantId: string): Promise<OAuth2Client | null> {
        const result = await this.dbPool.query<{
            encrypted_access_token: string; encrypted_refresh_token: string; expiry_date: string;
        }>(
            `SELECT encrypted_access_token, encrypted_refresh_token, expiry_date
             FROM gmail_oauth_tokens WHERE tenant_id = $1`,
            [tenantId]
        );
        const row = result.rows[0];
        if (!row) return null;

        const oauth2Client = this.createOAuth2Client();
        oauth2Client.setCredentials({
            access_token: decrypt(row.encrypted_access_token),
            refresh_token: decrypt(row.encrypted_refresh_token),
            expiry_date: Number(row.expiry_date),
        });

        oauth2Client.on('tokens', async (newTokens: { access_token?: string; expiry_date?: number }) => {
            if (!newTokens.access_token) return;
            await this.dbPool.query(
                `UPDATE gmail_oauth_tokens
                 SET encrypted_access_token = $1, expiry_date = $2, updated_at = NOW()
                 WHERE tenant_id = $3`,
                [encrypt(newTokens.access_token), newTokens.expiry_date ?? Date.now() + 3600_000, tenantId]
            );
        });

        return oauth2Client;
    }

    /**
     * Revoga o token junto ao Google e apaga a linha — não só marca como
     * inativo (requisito explícito do plano).
     */
    async disconnect(tenantId: string): Promise<void> {
        const result = await this.dbPool.query<{ encrypted_access_token: string }>(
            `SELECT encrypted_access_token FROM gmail_oauth_tokens WHERE tenant_id = $1`,
            [tenantId]
        );
        const row = result.rows[0];
        if (row) {
            try {
                const oauth2Client = this.createOAuth2Client();
                await oauth2Client.revokeToken(decrypt(row.encrypted_access_token));
            } catch (err) {
                logger.warn({ err, tenantId }, 'Falha ao revogar token do Gmail junto ao Google (prosseguindo com a remoção local)');
            }
        }

        await this.dbPool.query(`DELETE FROM gmail_oauth_tokens WHERE tenant_id = $1`, [tenantId]);
        logger.info({ tenantId }, '🔌 Gmail (extrato bancário) desconectado');
    }
}
