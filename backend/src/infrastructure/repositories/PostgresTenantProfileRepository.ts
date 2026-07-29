import { Pool } from 'pg';
import { UpdateTenantProfileDTO } from '../../domain/repositories/IPsychotherapyRepository';
import { TenantProfile } from '../../domain/models/TenantProfile';
import { NotFoundError } from '../../domain/errors/NotFoundError';
import { TenantProfileRow } from './dbRowTypes';
import { validateTenantId } from './shared';

/**
 * Extraído de PostgresPsychotherapyRepository (getTenantProfile/updateTenantProfile,
 * ambos classificados como FOLHA — sem transação própria, tabela única) sem alterar
 * nenhuma linha de lógica. Ver
 * .claude/plans/pendencias-tecnicas-pos-quitacao-2026-07.md (item 1) e
 * .claude/plans/classificacao-postgres-psychotherapy-repository.md.
 */
export class PostgresTenantProfileRepository {
    constructor(private readonly dbPool: Pool) {}

    async getTenantProfile(tenantId: string): Promise<TenantProfile | null> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT id, name, email, full_name, document, professional_id, address, totp_enabled, booking_page, card_fee_rates, transcription_preference, automatic_billing_reminders
            FROM tenants
            WHERE id = $1;
        `, [validTenantId]);

        return result.rows[0] ? this.mapTenantProfile(result.rows[0]) : null;
    }

    async listTenantsWithAutomaticBilling(): Promise<TenantProfile[]> {
        const result = await this.dbPool.query(`
            SELECT id, name, email, full_name, document, professional_id, address, totp_enabled, booking_page, card_fee_rates, transcription_preference, automatic_billing_reminders
            FROM tenants
            WHERE automatic_billing_reminders = TRUE;
        `);
        return result.rows.map(row => this.mapTenantProfile(row));
    }

    async updateTenantProfile(data: UpdateTenantProfileDTO): Promise<TenantProfile> {
        const tenantId = validateTenantId(data.tenantId);

        // card_fee_rates precisa distinguir "não veio no payload" (não mexe) de "veio null"
        // (limpa) — diferente dos demais campos, que usam COALESCE e por isso nunca
        // conseguem limpar um valor já salvo enviando null (mesma limitação de bookingPage).
        const cardFeeRatesProvided = data.cardFeeRates !== undefined;
        const cardFeeRatesValue = data.cardFeeRates === null || data.cardFeeRates === undefined
            ? null
            : JSON.stringify(data.cardFeeRates);

        const result = await this.dbPool.query(`
            UPDATE tenants
            SET
                full_name = COALESCE($2, full_name),
                document = COALESCE($3, document),
                professional_id = COALESCE($4, professional_id),
                address = COALESCE($5, address),
                booking_page = COALESCE($6::jsonb, booking_page),
                card_fee_rates = CASE WHEN $7 THEN $8::jsonb ELSE card_fee_rates END,
                transcription_preference = COALESCE($9, transcription_preference),
                automatic_billing_reminders = COALESCE($10, automatic_billing_reminders),
                updated_at = NOW()
            WHERE id = $1
            RETURNING id, name, email, full_name, document, professional_id, address, totp_enabled, booking_page, card_fee_rates, transcription_preference, automatic_billing_reminders;
        `, [
            tenantId,
            data.fullName !== undefined ? data.fullName : null,
            data.document !== undefined ? data.document : null,
            data.professionalId !== undefined ? data.professionalId : null,
            data.address !== undefined ? data.address : null,
            data.bookingPage !== undefined && data.bookingPage !== null ? JSON.stringify(data.bookingPage) : null,
            cardFeeRatesProvided,
            cardFeeRatesValue,
            data.transcriptionPreference !== undefined ? data.transcriptionPreference : null,
            data.automaticBillingReminders !== undefined ? data.automaticBillingReminders : null
        ]);

        if (result.rows.length === 0) throw new NotFoundError('Tenant não encontrado');
        return this.mapTenantProfile(result.rows[0]);
    }

    private mapTenantProfile(row: any): TenantProfile {
        return new TenantProfile(
            row.id,
            row.name,
            row.email,
            row.full_name,
            row.document,
            row.professional_id,
            row.address,
            row.totp_enabled || false,
            row.booking_page ?? null,
            row.card_fee_rates ?? null,
            row.transcription_preference ?? 'deepgram_web',
            row.automatic_billing_reminders ?? false
        );
    }

    async upsertTranscriptionIntegration(tenantId: string, provider: 'google_meet_native' | 'deepgram_web', status: 'pending_consent' | 'active' | 'revoked' | 'error', googleAccountId?: string, scopes?: string[]): Promise<void> {
        const validTenantId = validateTenantId(tenantId);
        await this.dbPool.query(`
            INSERT INTO transcription_integrations (tenant_id, provider, status, google_account_id, scopes_granted, enabled_at)
            VALUES ($1, $2, $3, $4, $5, CASE WHEN $3 = 'active' THEN NOW() ELSE NULL END)
            ON CONFLICT (tenant_id, provider) DO UPDATE SET
                status = EXCLUDED.status,
                google_account_id = COALESCE(EXCLUDED.google_account_id, transcription_integrations.google_account_id),
                scopes_granted = COALESCE(EXCLUDED.scopes_granted, transcription_integrations.scopes_granted),
                enabled_at = CASE WHEN EXCLUDED.status = 'active' AND transcription_integrations.status != 'active' THEN NOW() ELSE transcription_integrations.enabled_at END,
                revoked_at = CASE WHEN EXCLUDED.status = 'revoked' THEN NOW() ELSE NULL END,
                updated_at = NOW();
        `, [validTenantId, provider, status, googleAccountId || null, scopes ? scopes : null]);
    }
}
