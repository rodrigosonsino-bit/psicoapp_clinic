import { Pool } from 'pg';
import crypto from 'crypto';
import {
    ListAppointmentsOptions,
    UpcomingAppointment,
    PaginatedResult,
    MarkReminderSentOptions,
    SaveAppointmentDTO
} from '../../domain/repositories/IPsychotherapyRepository';
import { AppointmentStatus, PsychotherapyAppointment } from '../../domain/models/PsychotherapyAppointment';
import { NotFoundError } from '../../domain/errors/NotFoundError';
import { AppError } from '../../domain/errors/AppError';
import { validateTenantId, mapAppointment, toMonthStr } from './shared';
import { syncMonthlyRecord } from './MonthlyRecordSynchronizer';

/**
 * Extraído de PostgresPsychotherapyRepository (12 métodos de Appointments/Agenda
 * classificados como FOLHA — sem transação, sem invariante de concorrência) sem alterar
 * nenhuma linha de lógica, e posteriormente os 3 COMPLEXOS (`saveAppointment`,
 * `deleteAppointment`, `updateAppointmentStatus` — transação própria com `FOR UPDATE`, chamam
 * `syncMonthlyRecord`). **Assimetria proposital confirmada em 3 rodadas de auditoria, não
 * mexer sem reler**: `saveAppointment` chama `syncMonthlyRecord` DEPOIS do `COMMIT` (fora da
 * transação, via `this.dbPool`), enquanto `deleteAppointment`/`updateAppointmentStatus` chamam
 * DENTRO da transação (via `client`). Ver
 * .claude/plans/pendencias-tecnicas-pos-quitacao-2026-07.md (item 1) e
 * .claude/plans/classificacao-postgres-psychotherapy-repository.md.
 */
export class PostgresAppointmentRepository {
    constructor(private readonly dbPool: Pool) {}

    async saveAppointment(data: SaveAppointmentDTO): Promise<PsychotherapyAppointment> {
        const tenantId = validateTenantId(data.tenantId);

        const client = await this.dbPool.connect();
        try {
            await client.query('BEGIN');

            // Pré-leitura do agendamento anterior (reagendamento/troca de paciente), com lock —
            // evita corrida com uma exclusão/atualização concorrente do mesmo agendamento
            // (achado na revisão de 04/07/2026).
            let oldMonth: string | null = null;
            let oldPatientId: string | null = null;
            if (data.id) {
                const prev = await client.query(
                    `SELECT scheduled_at, patient_id FROM psychotherapy_appointments
                     WHERE id = $1 AND tenant_id = $2
                     FOR UPDATE`,
                    [data.id, tenantId]
                );
                if (prev.rows[0]) {
                    oldMonth = toMonthStr(new Date(prev.rows[0].scheduled_at));
                    oldPatientId = prev.rows[0].patient_id;
                }
            }

            const patientChanged = oldPatientId !== null && oldPatientId !== data.patientId;
            if (patientChanged) {
                // Reatribuir um agendamento pra outro paciente é uma operação rara e perigosa
                // se já existe conteúdo clínico registrado na sessão vinculada — nesse caso, a
                // troca é bloqueada (o operador deve criar um novo agendamento em vez de
                // reaproveitar este). Ver achado da revisão de 04/07/2026.
                // Conteúdo clínico = nota estruturada (psychotherapy_clinical_notes) OU texto
                // livre em session.notes (achado da 2ª revisão, 04/07/2026: a checagem original
                // só olhava a tabela estruturada, deixando passar session.notes preenchido).
                // Lock PRIMEIRO, checagem de conteúdo DEPOIS em consulta separada (achado da 4ª
                // revisão, 04/07/2026): um SELECT com FOR UPDATE + EXISTS no mesmo statement
                // pode não enxergar uma nota clínica confirmada por outra transação enquanto
                // esperava o lock (o EXISTS usa o snapshot do início do statement, só a própria
                // linha travada é reobtida). Serializa contra saveSession()/saveClinicalNote().
                const lock = await client.query(
                    `SELECT s.id FROM psychotherapy_sessions s
                     WHERE s.tenant_id = $1 AND s.appointment_id = $2
                     FOR UPDATE OF s`,
                    [tenantId, data.id]
                );
                const linkedSession = lock.rows.length === 0 ? { rows: [{}] } : await client.query(
                    `SELECT
                        (NULLIF(TRIM(s.notes), '') IS NOT NULL) AS has_notes,
                        EXISTS (
                            SELECT 1 FROM psychotherapy_clinical_notes cn WHERE cn.session_id = s.id
                        ) AS has_clinical_notes
                     FROM psychotherapy_sessions s
                     WHERE s.id = $1`,
                    [lock.rows[0].id]
                );
                if (linkedSession.rows[0]?.has_notes || linkedSession.rows[0]?.has_clinical_notes) {
                    throw new AppError(
                        'Não é possível trocar o paciente deste agendamento: já existe conteúdo ' +
                        'clínico registrado na sessão vinculada. Crie um novo agendamento.',
                        409
                    );
                }
            }

            const id = data.id || crypto.randomUUID();
            const duration = data.durationMinutes ?? 50;
            const scheduledAt = data.scheduledAt;
            const endedAt = new Date(scheduledAt.getTime() + duration * 60 * 1000);

            // Determinar se é grupo ou individual
            const isGroup = !!data.groupId;
            const eventType = isGroup ? 'group' : 'individual';
            let calendarEventId = data.calendarEventId;
            const eventStatus = (data.status === 'attended' || data.status === 'no_show') ? 'completed' : (data.status ?? 'scheduled');

            if (!calendarEventId) {
                if (isGroup) {
                    // Tenta achar evento do grupo no mesmo horário
                    const existingRes = await client.query(`
                        SELECT id FROM calendar_events
                        WHERE tenant_id = $1 AND group_id = $2 AND scheduled_at = $3;
                    `, [tenantId, data.groupId, scheduledAt]);
                    if (existingRes.rows.length > 0) {
                        calendarEventId = existingRes.rows[0].id;
                    } else {
                        calendarEventId = crypto.randomUUID();
                        await client.query(`
                            INSERT INTO calendar_events (id, tenant_id, scheduled_at, ended_at, duration_minutes, event_type, status, group_id)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
                        `, [calendarEventId, tenantId, scheduledAt, endedAt, duration, eventType, eventStatus, data.groupId]);
                    }
                } else {
                    // Individual usa 1-para-1 correspondência
                    calendarEventId = id;
                    await client.query(`
                        INSERT INTO calendar_events (id, tenant_id, scheduled_at, ended_at, duration_minutes, event_type, status, group_id)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)
                        ON CONFLICT (id) DO UPDATE SET
                            scheduled_at = EXCLUDED.scheduled_at,
                            ended_at = EXCLUDED.ended_at,
                            duration_minutes = EXCLUDED.duration_minutes,
                            status = EXCLUDED.status,
                            updated_at = NOW()
                        WHERE calendar_events.tenant_id = EXCLUDED.tenant_id;
                    `, [calendarEventId, tenantId, scheduledAt, endedAt, duration, eventType, eventStatus]);
                }
            } else {
                // Atualiza o evento correspondente se já existir
                await client.query(`
                    UPDATE calendar_events
                    SET scheduled_at = $1, ended_at = $2, duration_minutes = $3, status = $4, updated_at = NOW()
                    WHERE id = $5 AND tenant_id = $6;
                `, [scheduledAt, endedAt, duration, eventStatus, calendarEventId, tenantId]);
            }

            const result = await client.query(`
                INSERT INTO psychotherapy_appointments (
                    id, tenant_id, patient_id, scheduled_at, duration_minutes,
                    status, recurrence, recurrence_end_date, notes, parent_id,
                    calendar_event_id, group_id
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                ON CONFLICT (id) DO UPDATE SET
                    patient_id = EXCLUDED.patient_id,
                    scheduled_at = EXCLUDED.scheduled_at,
                    duration_minutes = EXCLUDED.duration_minutes,
                    status = EXCLUDED.status,
                    recurrence = EXCLUDED.recurrence,
                    recurrence_end_date = EXCLUDED.recurrence_end_date,
                    notes = EXCLUDED.notes,
                    parent_id = EXCLUDED.parent_id,
                    calendar_event_id = EXCLUDED.calendar_event_id,
                    group_id = EXCLUDED.group_id,
                    updated_at = NOW()
                WHERE psychotherapy_appointments.tenant_id = EXCLUDED.tenant_id
                RETURNING *;
            `, [
                id,
                tenantId,
                data.patientId,
                scheduledAt,
                duration,
                data.status ?? 'scheduled',
                data.recurrence ?? 'none',
                data.recurrenceEndDate ?? null,
                data.notes ?? null,
                data.parentId || null,
                calendarEventId,
                data.groupId || null
            ]);

            if (result.rows.length === 0) {
                throw new NotFoundError('Agendamento não encontrado ou não autorizado');
            }

            // Sincronização com o Diário de Sessões (vínculo por appointment_id, migration 082).
            // saveAppointment() é usado tanto pra criar/editar quanto pelo fluxo de "atendimento
            // retroativo" do frontend (agendamento já criado com status='attended' desde o
            // início) — antes desta correção, só updateAppointmentStatus() sincronizava a
            // sessão, então o fluxo retroativo nunca gerava sessão nenhuma (achado da revisão
            // de 03/07/2026). Mesma lógica de status → session_status usada lá.
            //
            // IMPORTANTE (achado da revisão de 04/07/2026): NÃO copiar appointment.notes pra
            // session.notes. São conteúdos diferentes — notes do agendamento é observação de
            // agenda, notes da sessão é conteúdo clínico (protegido de exclusão em outros
            // pontos deste arquivo). Copiar aqui arriscava sobrescrever silenciosamente uma
            // nota clínica já registrada. notes da sessão só é gerenciado via saveSession()/
            // Diário — nunca por este fluxo.
            const finalStatus = result.rows[0].status;
            if (finalStatus === 'attended' || finalStatus === 'no_show' || finalStatus === 'canceled') {
                const targetSessionStatus =
                    finalStatus === 'attended' ? 'attended' :
                    finalStatus === 'no_show'  ? 'unjustified_absence' : 'canceled';

                await client.query(`
                    INSERT INTO psychotherapy_sessions (id, tenant_id, patient_id, date, status, appointment_id)
                    VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
                    ON CONFLICT (appointment_id) WHERE appointment_id IS NOT NULL DO UPDATE SET
                        patient_id = EXCLUDED.patient_id,
                        date = EXCLUDED.date,
                        status = EXCLUDED.status,
                        updated_at = NOW();
                `, [tenantId, data.patientId, scheduledAt, targetSessionStatus, id]);
            } else {
                // Reverter pra scheduled/confirmed com conteúdo clínico registrado deixaria um
                // estado contraditório (agendamento "scheduled", sessão ainda "attended" com
                // nota) — bloqueado explicitamente em vez de preservar silenciosamente (achado
                // da 2ª revisão, 04/07/2026). Lock primeiro, checagem de conteúdo depois em
                // consulta separada (achado da 4ª revisão, 04/07/2026 — ver comentário
                // equivalente na checagem de troca de paciente acima).
                const lockRev = await client.query(`
                    SELECT s.id FROM psychotherapy_sessions s
                    WHERE s.tenant_id = $1 AND s.appointment_id = $2
                    FOR UPDATE OF s
                `, [tenantId, id]);
                const linkedContent = lockRev.rows.length === 0 ? { rows: [{}] } : await client.query(`
                    SELECT
                        (NULLIF(TRIM(s.notes), '') IS NOT NULL) AS has_notes,
                        EXISTS (
                            SELECT 1 FROM psychotherapy_clinical_notes cn WHERE cn.session_id = s.id
                        ) AS has_clinical_notes
                    FROM psychotherapy_sessions s
                    WHERE s.id = $1
                `, [lockRev.rows[0].id]);

                if (linkedContent.rows[0]?.has_notes || linkedContent.rows[0]?.has_clinical_notes) {
                    throw new AppError(
                        'Não é possível reverter este agendamento: a sessão vinculada tem ' +
                        'conteúdo clínico registrado. Remova o conteúdo clínico antes de reverter.',
                        409
                    );
                }

                await client.query(`
                    DELETE FROM psychotherapy_sessions
                    WHERE tenant_id = $1 AND appointment_id = $2;
                `, [tenantId, id]);
            }

            await client.query('COMMIT');

            const appointment = mapAppointment(result.rows[0]);
            const newMonth = toMonthStr(data.scheduledAt);
            await syncMonthlyRecord(this.dbPool, tenantId, data.patientId, newMonth);
            if (oldMonth && oldMonth !== newMonth) {
                // Se o paciente também mudou, o mês antigo pertence ao paciente ANTERIOR, não
                // ao novo (achado da revisão de 04/07/2026).
                await syncMonthlyRecord(this.dbPool, tenantId, oldPatientId ?? data.patientId, oldMonth);
            }
            if (patientChanged && oldPatientId) {
                // Mesmo sem mudança de mês, o registro mensal do paciente anterior no mês
                // atual também precisa ser recalculado (perdeu este agendamento).
                await syncMonthlyRecord(this.dbPool, tenantId, oldPatientId, newMonth);
            }

            return appointment;
        } catch (error: any) {
            await client.query('ROLLBACK');
            if (error.code === '23P01') {
                throw new AppError('Este horário conflita com outro agendamento ativo.', 409);
            }
            throw error;
        } finally {
            client.release();
        }
    }

    async deleteAppointment(tenantId: string, id: string): Promise<void> {
        const validTenantId = validateTenantId(tenantId);
        const client = await this.dbPool.connect();

        try {
            await client.query('BEGIN');

            // 1. Lê o agendamento + dados do paciente antes de deletar, com lock — evita
            // corrida com um update/save concorrente do mesmo agendamento (achado na revisão
            // de 04/07/2026: sem FOR UPDATE, uma sessão podia ser recriada entre o DELETE da
            // sessão abaixo e o DELETE do agendamento).
            const appQuery = await client.query(`
                SELECT
                    a.patient_id, a.scheduled_at, a.status,
                    a.calendar_event_id, a.group_id,
                    p.payment_type, p.default_session_price_cents,
                    p.name AS patient_name, p.status AS patient_status
                FROM psychotherapy_appointments a
                JOIN psychotherapy_patients p ON p.id = a.patient_id
                WHERE a.tenant_id = $1 AND a.id = $2
                FOR UPDATE OF a
            `, [validTenantId, id]);

            if (appQuery.rows.length === 0)
                throw new NotFoundError('Agendamento não encontrado ou não autorizado');

            const { patient_id, scheduled_at, status, payment_type, calendar_event_id, group_id } = appQuery.rows[0];

            // 3. Remove sessão correspondente (somente se sem notas clínicas). Vínculo por
            // appointment_id (FK composta, migration 082) — ver nota em updateAppointmentStatus.
            await client.query(`
                DELETE FROM psychotherapy_sessions
                WHERE tenant_id = $1 AND appointment_id = $2
                  AND (notes IS NULL OR TRIM(notes) = '')
                  AND NOT EXISTS (
                      SELECT 1 FROM psychotherapy_clinical_notes
                      WHERE session_id = psychotherapy_sessions.id
                  )
            `, [validTenantId, id]);

            // 3b. Sessões PRESERVADAS (com nota clínica) precisam ter o vínculo desfeito antes
            // de excluir o agendamento — a FK (appointment_id, tenant_id) não tem ON DELETE
            // SET NULL (evitar zerar tenant_id, que é NOT NULL, numa FK composta), então sem
            // isso o DELETE do agendamento abaixo violaria a FK.
            await client.query(`
                UPDATE psychotherapy_sessions
                SET appointment_id = NULL, updated_at = NOW()
                WHERE tenant_id = $1 AND appointment_id = $2
            `, [validTenantId, id]);

            // 4. Deleta o agendamento
            const del = await client.query(`
                DELETE FROM psychotherapy_appointments
                WHERE tenant_id = $1 AND id = $2
            `, [validTenantId, id]);

            if (del.rowCount === 0)
                throw new NotFoundError('Agendamento não encontrado ou não autorizado');

            // 5. Remove calendar_event associado se for individual
            if (calendar_event_id && !group_id) {
                await client.query(`
                    DELETE FROM calendar_events
                    WHERE id = $1 AND tenant_id = $2
                `, [calendar_event_id, validTenantId]);
            }

            await syncMonthlyRecord(
                client,
                validTenantId,
                patient_id,
                toMonthStr(new Date(scheduled_at))
            );

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    async updateAppointmentStatus(tenantId: string, id: string, status: AppointmentStatus): Promise<PsychotherapyAppointment> {
        const validTenantId = validateTenantId(tenantId);
        const client = await this.dbPool.connect();

        try {
            await client.query('BEGIN');

            // ── Pré-leitura: old_status + dados do paciente (com lock, ver deleteAppointment) ──
            const preQuery = await client.query(`
                SELECT
                    a.patient_id, a.scheduled_at, a.status AS old_status,
                    a.calendar_event_id, a.group_id,
                    p.name   AS patient_name,
                    p.status AS patient_status,
                    p.payment_type,
                    p.default_session_price_cents
                FROM psychotherapy_appointments a
                JOIN psychotherapy_patients p ON p.id = a.patient_id
                WHERE a.tenant_id = $1 AND a.id = $2
                FOR UPDATE OF a
            `, [validTenantId, id]);

            if (preQuery.rows.length === 0)
                throw new NotFoundError('Agendamento não encontrado ou não autorizado');

            const {
                patient_id, scheduled_at,
                old_status,
                patient_name, patient_status,
                payment_type, default_session_price_cents,
                calendar_event_id, group_id
            } = preQuery.rows[0];

            // ── 1. Atualiza status ────────────────────────────────────────────
            const result = await client.query(`
                UPDATE psychotherapy_appointments
                SET status = $1, updated_at = NOW()
                WHERE tenant_id = $2 AND id = $3
                RETURNING *;
            `, [status, validTenantId, id]);

            const appointment = result.rows[0];

            // ── 1.1 Atualiza status do calendar_event correspondente se for individual
            if (calendar_event_id && !group_id) {
                const targetEventStatus = (status === 'attended' || status === 'no_show') ? 'completed' : status;
                await client.query(`
                    UPDATE calendar_events
                    SET status = $1, updated_at = NOW()
                    WHERE id = $2 AND tenant_id = $3;
                `, [targetEventStatus, calendar_event_id, validTenantId]);
            }

            // ── 2. Sincronização com o Diário de Sessões ──────────────────────
            // Vínculo por appointment_id (FK, migration 082) — não mais por
            // (tenant_id, patient_id, date). O heurístico por data quebrava em reagendamentos
            // (a sessão ficava órfã na data antiga) e não cobria edições feitas via
            // saveAppointment(). Ver achado da revisão de 03/07/2026.
            if (status === 'attended' || status === 'no_show' || status === 'canceled') {
                const targetSessionStatus =
                    status === 'attended'  ? 'attended' :
                    status === 'no_show'   ? 'unjustified_absence' : 'canceled';

                const sessionCheck = await client.query(`
                    SELECT id FROM psychotherapy_sessions
                    WHERE tenant_id = $1 AND appointment_id = $2
                    LIMIT 1;
                `, [validTenantId, id]);

                // IMPORTANTE (achado da revisão de 04/07/2026): não copiar appointment.notes
                // pra session.notes — são conteúdos diferentes, e sobrescreveria uma nota
                // clínica já registrada. notes da sessão só é gerenciado via saveSession().
                if (sessionCheck.rows.length > 0) {
                    await client.query(`
                        UPDATE psychotherapy_sessions
                        SET status = $1, date = $2, updated_at = NOW()
                        WHERE id = $3;
                    `, [targetSessionStatus, scheduled_at, sessionCheck.rows[0].id]);
                } else {
                    await client.query(`
                        INSERT INTO psychotherapy_sessions (id, tenant_id, patient_id, date, status, appointment_id)
                        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5);
                    `, [validTenantId, patient_id, scheduled_at, targetSessionStatus, id]);
                }
            } else if (status === 'scheduled' || status === 'confirmed') {
                // Mesma regra de saveAppointment(): bloquear em vez de preservar silenciosamente
                // um estado contraditório (achado da 2ª revisão, 04/07/2026). Lock primeiro,
                // checagem depois em consulta separada (achado da 4ª revisão, 04/07/2026).
                const lockRev2 = await client.query(`
                    SELECT s.id FROM psychotherapy_sessions s
                    WHERE s.tenant_id = $1 AND s.appointment_id = $2
                    FOR UPDATE OF s
                `, [validTenantId, id]);
                const linkedContent = lockRev2.rows.length === 0 ? { rows: [{}] } : await client.query(`
                    SELECT
                        (NULLIF(TRIM(s.notes), '') IS NOT NULL) AS has_notes,
                        EXISTS (
                            SELECT 1 FROM psychotherapy_clinical_notes cn WHERE cn.session_id = s.id
                        ) AS has_clinical_notes
                    FROM psychotherapy_sessions s
                    WHERE s.id = $1
                `, [lockRev2.rows[0].id]);

                if (linkedContent.rows[0]?.has_notes || linkedContent.rows[0]?.has_clinical_notes) {
                    throw new AppError(
                        'Não é possível reverter este agendamento: a sessão vinculada tem ' +
                        'conteúdo clínico registrado. Remova o conteúdo clínico antes de reverter.',
                        409
                    );
                }

                await client.query(`
                    DELETE FROM psychotherapy_sessions
                    WHERE tenant_id = $1 AND appointment_id = $2;
                `, [validTenantId, id]);
            }

            await syncMonthlyRecord(
                client,
                validTenantId,
                patient_id,
                toMonthStr(new Date(scheduled_at))
            );

            await client.query('COMMIT');
            return mapAppointment(appointment);
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

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
