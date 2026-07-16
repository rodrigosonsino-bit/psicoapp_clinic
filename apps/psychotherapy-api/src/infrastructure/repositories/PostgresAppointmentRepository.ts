import { Pool } from 'pg';
import {
    ListAppointmentsOptions,
    UpcomingAppointment,
    PaginatedResult,
    MarkReminderSentOptions
} from '../../domain/repositories/IPsychotherapyRepository';
import { PsychotherapyAppointment } from '../../domain/models/PsychotherapyAppointment';
import { validateTenantId, mapAppointment } from './shared';

/**
 * Extraído de PostgresPsychotherapyRepository (12 métodos de Appointments/Agenda
 * classificados como FOLHA — sem transação, sem invariante de concorrência) sem alterar
 * nenhuma linha de lógica. `saveAppointment`, `deleteAppointment` e `updateAppointmentStatus`
 * permanecem no arquivo principal (COMPLEXOS — transação própria com `FOR UPDATE`, chamam
 * `syncMonthlyRecord`). Ver
 * .claude/plans/pendencias-tecnicas-pos-quitacao-2026-07.md (item 1) e
 * .claude/plans/classificacao-postgres-psychotherapy-repository.md.
 */
export class PostgresAppointmentRepository {
    constructor(private readonly dbPool: Pool) {}

    async listAppointments(tenantId: string, options: ListAppointmentsOptions = {}): Promise<PaginatedResult<PsychotherapyAppointment>> {
        const validTenantId = validateTenantId(tenantId);
        const params: unknown[] = [validTenantId];
        let whereClause = 'WHERE tenant_id = $1';

        if (options.patientId) {
            params.push(options.patientId);
            whereClause += ` AND patient_id = $${params.length}`;
        }
        if (options.start) {
            params.push(options.start);
            whereClause += ` AND scheduled_at >= $${params.length}`;
        }
        if (options.end) {
            params.push(options.end);
            whereClause += ` AND scheduled_at <= $${params.length}`;
        }

        const page = options.page ?? 1;
        const limit = options.limit ?? 50;
        const offset = (page - 1) * limit;
        params.push(limit, offset);

        const result = await this.dbPool.query(`
            SELECT *, COUNT(*) OVER() AS total_count
            FROM psychotherapy_appointments
            ${whereClause}
            ORDER BY scheduled_at ASC
            LIMIT $${params.length - 1} OFFSET $${params.length};
        `, params);

        if (result.rows.length === 0) return { data: [], total: 0 };
        const total = parseInt(result.rows[0].total_count, 10);
        return {
            data: result.rows.map(row => mapAppointment(row)),
            total
        };
    }

    async findAppointmentById(tenantId: string, id: string): Promise<PsychotherapyAppointment | null> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT * FROM psychotherapy_appointments
            WHERE tenant_id = $1 AND id = $2;
        `, [validTenantId, id]);
        return result.rows[0] ? mapAppointment(result.rows[0]) : null;
    }

    async findUpcomingAppointments(windowStart: Date, windowEnd: Date): Promise<UpcomingAppointment[]> {
        const result = await this.dbPool.query(`
            SELECT
                a.id            AS appointment_id,
                a.tenant_id,
                t.name          AS tenant_name,
                a.patient_id,
                p.name          AS patient_name,
                p.phone         AS patient_phone,
                p.email         AS patient_email,
                p.reminder_channel,
                a.scheduled_at,
                a.duration_minutes,
                t.whatsapp_reminder_template
            FROM psychotherapy_appointments a
            JOIN psychotherapy_patients p ON p.id = a.patient_id
            JOIN tenants t ON t.id = a.tenant_id
            WHERE a.scheduled_at >= $1
              AND a.scheduled_at < $2
              AND a.status IN ('scheduled', 'confirmed')
              AND p.reminder_channel <> 'none'
            ORDER BY a.scheduled_at ASC;
        `, [windowStart, windowEnd]);

        return result.rows.map(row => ({
            appointmentId:  row.appointment_id,
            tenantId:       row.tenant_id,
            tenantName:     row.tenant_name,
            patientId:      row.patient_id,
            patientName:    row.patient_name,
            patientPhone:   row.patient_phone,
            patientEmail:   row.patient_email,
            reminderChannel: row.reminder_channel ?? 'whatsapp',
            scheduledAt:    new Date(row.scheduled_at),
            durationMinutes: row.duration_minutes,
            whatsappReminderTemplate: row.whatsapp_reminder_template ?? null,
        }));
    }

    async findFailedWhatsappReminders(now: Date, windowStart: Date, maxAttempts: number): Promise<UpcomingAppointment[]> {
        const result = await this.dbPool.query(`
            SELECT
                a.id            AS appointment_id,
                a.tenant_id,
                t.name          AS tenant_name,
                a.patient_id,
                p.name          AS patient_name,
                p.phone         AS patient_phone,
                p.email         AS patient_email,
                p.reminder_channel,
                a.scheduled_at,
                a.duration_minutes,
                t.whatsapp_reminder_template
            FROM psychotherapy_appointments a
            JOIN psychotherapy_patients p ON p.id = a.patient_id
            JOIN tenants t ON t.id = a.tenant_id
            WHERE a.scheduled_at > $1
              AND a.scheduled_at < $2
              AND a.status IN ('scheduled', 'confirmed')
              AND p.reminder_channel IN ('whatsapp', 'both')
              AND EXISTS (
                  SELECT 1 FROM psychotherapy_reminders_log rl
                  WHERE rl.appointment_id = a.id AND rl.channel_used = 'whatsapp' AND rl.status = 'failed'
              )
              AND NOT EXISTS (
                  SELECT 1 FROM psychotherapy_reminders_log rl2
                  WHERE rl2.appointment_id = a.id AND rl2.channel_used = 'whatsapp' AND rl2.status = 'success'
              )
              AND (
                  SELECT COUNT(*) FROM psychotherapy_reminders_log rl3
                  WHERE rl3.appointment_id = a.id AND rl3.channel_used = 'whatsapp' AND rl3.status = 'failed'
              ) < $3
              -- A TENTATIVA MAIS RECENTE (não "alguma") precisa ser elegível para retry —
              -- se o último resultado foi ambíguo (timeout/5xx da Cloud API), a mensagem pode já
              -- ter sido entregue, então não reenviamos automaticamente mesmo que uma tentativa
              -- anterior tenha sido uma rejeição comum e elegível.
              AND COALESCE((
                  SELECT rl4.retry_eligible FROM psychotherapy_reminders_log rl4
                  WHERE rl4.appointment_id = a.id AND rl4.channel_used = 'whatsapp'
                  ORDER BY rl4.sent_at DESC, rl4.id DESC LIMIT 1
              ), TRUE) = TRUE
            ORDER BY a.scheduled_at ASC;
        `, [now, windowStart, maxAttempts]);

        return result.rows.map(row => ({
            appointmentId:  row.appointment_id,
            tenantId:       row.tenant_id,
            tenantName:     row.tenant_name,
            patientId:      row.patient_id,
            patientName:    row.patient_name,
            patientPhone:   row.patient_phone,
            patientEmail:   row.patient_email,
            reminderChannel: row.reminder_channel ?? 'whatsapp',
            scheduledAt:    new Date(row.scheduled_at),
            durationMinutes: row.duration_minutes,
            whatsappReminderTemplate: row.whatsapp_reminder_template ?? null,
        }));
    }

    async markReminderSent(
        appointmentId: string,
        tenantId: string,
        channelUsed: 'whatsapp' | 'email',
        status: 'success' | 'failed',
        errorMessage?: string,
        options?: MarkReminderSentOptions
    ): Promise<void> {
        await this.dbPool.query(`
            INSERT INTO psychotherapy_reminders_log
                (tenant_id, appointment_id, channel_used, status, error_message, provider, retry_eligible)
            VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, TRUE));
        `, [
            tenantId, appointmentId, channelUsed, status, errorMessage ?? null,
            options?.provider ?? null,
            options?.retryEligible,
        ]);
    }

    async hasReminderBeenSent(appointmentId: string, channelUsed: 'whatsapp' | 'email'): Promise<boolean> {
        const result = await this.dbPool.query(`
            SELECT 1 FROM psychotherapy_reminders_log
            WHERE appointment_id = $1
              AND channel_used = $2
              AND status = 'success'
            LIMIT 1;
        `, [appointmentId, channelUsed]);
        return result.rows.length > 0;
    }

    async findAppointmentByGoogleEventId(tenantId: string, googleEventId: string): Promise<PsychotherapyAppointment | null> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT * FROM psychotherapy_appointments
            WHERE tenant_id = $1 AND google_event_id = $2;
        `, [validTenantId, googleEventId]);
        return result.rows[0] ? mapAppointment(result.rows[0]) : null;
    }

    async updateAppointmentGoogleEvent(id: string, tenantId: string, googleEventId: string, googleEventUrl: string): Promise<void> {
        const validTenantId = validateTenantId(tenantId);
        await this.dbPool.query(`
            UPDATE psychotherapy_appointments
            SET google_event_id = $3, google_event_url = $4, updated_at = NOW()
            WHERE id = $1 AND tenant_id = $2;
        `, [id, validTenantId, googleEventId, googleEventUrl]);
    }

    async findAppointmentByConfirmToken(token: string): Promise<PsychotherapyAppointment | null> {
        const result = await this.dbPool.query(`
            SELECT * FROM psychotherapy_appointments WHERE confirm_token = $1::uuid;
        `, [token]);
        return result.rows[0] ? mapAppointment(result.rows[0]) : null;
    }

    async confirmAppointmentByToken(token: string): Promise<PsychotherapyAppointment | null> {
        const result = await this.dbPool.query(`
            UPDATE psychotherapy_appointments
            SET status = 'confirmed', confirmed_at = NOW(), updated_at = NOW()
            WHERE confirm_token = $1::uuid AND status = 'scheduled'
            RETURNING *;
        `, [token]);
        return result.rows[0] ? mapAppointment(result.rows[0]) : null;
    }

    async listActiveAppointmentDatetimes(tenantId: string, from: Date, to: Date): Promise<Date[]> {
        const validTenantId = validateTenantId(tenantId);
        const result = await this.dbPool.query(`
            SELECT scheduled_at FROM psychotherapy_appointments
            WHERE tenant_id = $1
              AND scheduled_at >= $2
              AND scheduled_at < $3
              AND status NOT IN ('canceled', 'no_show');
        `, [validTenantId, from, to]);
        return result.rows.map(r => new Date(r.scheduled_at));
    }

    async listSeriesAppointments(tenantId: string, rootId: string): Promise<PsychotherapyAppointment[]> {
        const result = await this.dbPool.query(
            `SELECT * FROM psychotherapy_appointments
             WHERE tenant_id = $1 AND (id = $2 OR parent_id = $2)
             ORDER BY scheduled_at ASC`,
            [tenantId, rootId]
        );
        return result.rows.map(row => mapAppointment(row));
    }
}
