import { Pool } from 'pg';
import { SaveAvailabilitySlotDTO } from '../../domain/repositories/IPsychotherapyRepository';
import { AvailabilitySlot, AvailabilityRecurrenceType, AvailabilityModality } from '../../domain/models/AvailabilitySlot';
import { NotFoundError } from '../../domain/errors/NotFoundError';
import { AvailabilitySlotRow } from './dbRowTypes';
import { validateTenantId } from './shared';

/**
 * Extraído de PostgresPsychotherapyRepository (os 3 métodos de Availability Slots,
 * classificados como FOLHA — CRUD de tabela única `psychotherapy_availability_slots`, sem
 * transação, sem side effect cross-domain) sem alterar nenhuma linha de lógica. Ver
 * .claude/plans/pendencias-tecnicas-pos-quitacao-2026-07.md (item 1) e
 * .claude/plans/classificacao-postgres-psychotherapy-repository.md.
 */
export class PostgresAvailabilitySlotRepository {
    constructor(private readonly dbPool: Pool) {}

    async saveAvailabilitySlot(data: SaveAvailabilitySlotDTO): Promise<AvailabilitySlot> {
        const tenantId = validateTenantId(data.tenantId);
        const result = await this.dbPool.query(`
            INSERT INTO psychotherapy_availability_slots
                (id, tenant_id, day_of_week, start_time, duration_minutes, is_active, notes, recurrence_type, start_date, modality)
            VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (id) DO UPDATE SET
                day_of_week      = EXCLUDED.day_of_week,
                start_time       = EXCLUDED.start_time,
                duration_minutes = EXCLUDED.duration_minutes,
                is_active        = EXCLUDED.is_active,
                notes            = EXCLUDED.notes,
                recurrence_type  = EXCLUDED.recurrence_type,
                start_date       = EXCLUDED.start_date,
                modality         = EXCLUDED.modality,
                updated_at       = NOW()
            WHERE psychotherapy_availability_slots.tenant_id = EXCLUDED.tenant_id
            RETURNING *;
        `, [
            data.id ?? null,
            tenantId,
            data.dayOfWeek,
            data.startTime,
            data.durationMinutes ?? 50,
            data.isActive ?? true,
            data.notes ?? null,
            data.recurrenceType ?? 'weekly',
            data.startDate ?? null,
            data.modality ?? 'presencial'
        ]);

        if (result.rows.length === 0) throw new NotFoundError('Horário não encontrado ou não autorizado');
        return this.mapAvailabilitySlot(result.rows[0]);
    }

    async listAvailabilitySlots(tenantId: string): Promise<AvailabilitySlot[]> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT * FROM psychotherapy_availability_slots
            WHERE tenant_id = $1
            ORDER BY day_of_week, start_time;
        `, [validTenantId]);
        return result.rows.map(row => this.mapAvailabilitySlot(row));
    }

    async deleteAvailabilitySlot(tenantId: string, id: string): Promise<void> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            DELETE FROM psychotherapy_availability_slots WHERE tenant_id = $1 AND id = $2;
        `, [validTenantId, id]);
        if (result.rowCount === 0) throw new NotFoundError('Horário não encontrado ou não autorizado');
    }

    private mapAvailabilitySlot(row: AvailabilitySlotRow): AvailabilitySlot {
        return new AvailabilitySlot(
            row.id, row.tenant_id, row.day_of_week,
            typeof row.start_time === 'string' ? row.start_time.slice(0, 5) : String(row.start_time),
            row.duration_minutes, row.is_active, row.notes,
            new Date(row.created_at), new Date(row.updated_at),
            (row.recurrence_type ?? 'weekly') as AvailabilityRecurrenceType,
            row.start_date ? new Date(row.start_date) : null,
            (row.modality ?? 'presencial') as AvailabilityModality
        );
    }
}
