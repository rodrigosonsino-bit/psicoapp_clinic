import { Pool } from 'pg';
import { BookingLink } from '../../domain/models/BookingLink';
import { BookingLinkRow } from './dbRowTypes';
import { validateTenantId } from './shared';

/**
 * Extraído de PostgresPsychotherapyRepository (os 3 métodos de Booking Links + os 2 de Public
 * Booking Tokens, classificados como FOLHA — CRUD de tabela única, sem transação, sem side
 * effect cross-domain) sem alterar nenhuma linha de lógica. Ver
 * .claude/plans/pendencias-tecnicas-pos-quitacao-2026-07.md (item 1) e
 * .claude/plans/classificacao-postgres-psychotherapy-repository.md.
 */
export class PostgresBookingLinkRepository {
    constructor(private readonly dbPool: Pool) {}

    async upsertBookingLink(tenantId: string, patientId: string, expiresAt?: Date | null): Promise<BookingLink> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            INSERT INTO psychotherapy_booking_links (tenant_id, patient_id, expires_at, is_active)
            VALUES ($1, $2, $3, TRUE)
            ON CONFLICT (tenant_id, patient_id) DO UPDATE SET
                token      = gen_random_uuid(),
                expires_at = EXCLUDED.expires_at,
                is_active  = TRUE,
                updated_at = NOW()
            RETURNING *;
        `, [validTenantId, patientId, expiresAt ?? null]);
        return this.mapBookingLink(result.rows[0]);
    }

    async findBookingLinkByToken(token: string): Promise<BookingLink | null> {
        const result = await this.dbPool.query(`
            SELECT * FROM psychotherapy_booking_links WHERE token = $1::uuid;
        `, [token]);
        return result.rows[0] ? this.mapBookingLink(result.rows[0]) : null;
    }

    async deactivateBookingLink(tenantId: string, patientId: string): Promise<void> {
        const validTenantId = validateTenantId(tenantId);
        await this.dbPool.query(`
            UPDATE psychotherapy_booking_links SET is_active = FALSE, updated_at = NOW()
            WHERE tenant_id = $1 AND patient_id = $2;
        `, [validTenantId, patientId]);
    }

    async getOrCreatePublicBookingToken(tenantId: string): Promise<string> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            INSERT INTO psychotherapy_public_booking_tokens (tenant_id)
            VALUES ($1)
            ON CONFLICT (tenant_id) DO UPDATE SET
                is_active  = TRUE,
                updated_at = NOW()
            RETURNING token::text
        `, [validTenantId]);
        return result.rows[0].token;
    }

    async findPublicBookingToken(token: string): Promise<string | null> {
        const result = await this.dbPool.query(`
            SELECT tenant_id FROM psychotherapy_public_booking_tokens
            WHERE token = $1::uuid AND is_active = TRUE
        `, [token]);
        return result.rows[0]?.tenant_id ?? null;
    }

    private mapBookingLink(row: BookingLinkRow): BookingLink {
        return new BookingLink(
            row.id, row.token, row.tenant_id, row.patient_id,
            row.expires_at ? new Date(row.expires_at) : null,
            row.is_active, new Date(row.created_at), new Date(row.updated_at)
        );
    }
}
