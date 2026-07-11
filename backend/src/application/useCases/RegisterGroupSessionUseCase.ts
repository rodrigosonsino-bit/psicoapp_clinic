import { injectable, inject } from 'tsyringe';
import { Pool, PoolClient } from 'pg';
import { AppError } from '../../domain/errors/AppError';
import { NotFoundError } from '../../domain/errors/NotFoundError';
import { GroupAttendanceStatus, GroupSessionRecord, groupSessionDatetime } from '../../domain/models/TherapyGroup';
import { logger } from '../../infrastructure/logger';

// ── DTOs públicos ────────────────────────────────────────────────────────────

export interface GroupMemberAttendance {
    groupMemberId: string;
    status: GroupAttendanceStatus; // 'present' | 'absent' | 'excused'
    notes?: string | null;
    /** Override de preço para este paciente nesta sessão. Null = usa o padrão do grupo. */
    sessionPriceCentsOverride?: number | null;
}

export interface RegisterGroupSessionInput {
    tenantId: string;
    groupId: string;
    /** Data da sessão — string "YYYY-MM-DD" */
    sessionDate: string;
    /** Lista de presenças/faltas de cada membro */
    attendances: GroupMemberAttendance[];
    /** Notas gerais da sessão (opcionais) */
    sessionNotes?: string | null;
}

export interface RegisterGroupSessionResult {
    groupId: string;
    sessionDate: string;
    records: GroupSessionRecord[];
    /** Agendamentos criados/atualizados */
    appointmentsProcessed: number;
}

// ── Helper: mês no fuso America/Sao_Paulo ────────────────────────────────────

function toMonthStrBRT(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
    }).formatToParts(date);
    const y = parts.find(p => p.type === 'year')!.value;
    const m = parts.find(p => p.type === 'month')!.value;
    return `${y}-${m}`;
}

// ── Use Case ─────────────────────────────────────────────────────────────────

@injectable()
export class RegisterGroupSessionUseCase {
    constructor(
        @inject(Pool) private readonly dbPool: Pool
    ) {}

    async execute(input: RegisterGroupSessionInput): Promise<RegisterGroupSessionResult> {
        const { tenantId, groupId, sessionDate, attendances, sessionNotes } = input;

        // ── Validações básicas ────────────────────────────────────────────────
        if (!tenantId || !groupId || !sessionDate) {
            throw new AppError('tenantId, groupId e sessionDate são obrigatórios.', 400);
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
            throw new AppError('sessionDate deve estar no formato YYYY-MM-DD.', 400);
        }
        if (!attendances || attendances.length === 0) {
            throw new AppError('É necessário informar a presença de ao menos um membro.', 400);
        }
        if (attendances.some(a => !a.groupMemberId)) {
            throw new AppError('Cada presença deve ter um groupMemberId válido.', 400);
        }
        const validStatuses: GroupAttendanceStatus[] = ['present', 'absent', 'excused'];
        if (attendances.some(a => !validStatuses.includes(a.status))) {
            throw new AppError('Status de presença inválido. Use: present, absent ou excused.', 400);
        }

        const client = await this.dbPool.connect();

        try {
            await client.query('BEGIN');

            // ── 1. Verificar grupo existe e pertence ao tenant ────────────────
            const groupResult = await client.query(`
                SELECT id, name, session_price_cents, start_time, duration_minutes, is_active, deleted_at, monthly_fee_cents
                FROM therapy_groups
                WHERE id = $1 AND tenant_id = $2
                LIMIT 1;
            `, [groupId, tenantId]);

            if (groupResult.rows.length === 0) {
                throw new NotFoundError(`Grupo ${groupId} não encontrado ou não pertence a este tenant.`);
            }
            const group = groupResult.rows[0];
            if (!group.is_active || group.deleted_at !== null) {
                throw new AppError('Este grupo está inativo ou foi excluído. Não é possível registrar sessões.', 409);
            }

            const groupPriceCents: number = group.session_price_cents;
            const groupStartTime: string = group.start_time ?? '00:00'; // "HH:MM:SS" → slice
            const startTimeHHMM = groupStartTime.slice(0, 5); // "HH:MM"
            const durationMinutes: number = group.duration_minutes;

            // ── 2. Construir o TIMESTAMPTZ correto (BRT -03:00) ──────────────
            const scheduledAt = groupSessionDatetime(sessionDate, startTimeHHMM);

            // ── 3. Verificar que todos os pacientes são membros ativos do grupo e buscar políticas ─
            const groupMemberIds = attendances.map(a => a.groupMemberId);
            const membersResult = await client.query(`
                SELECT gm.id as group_member_id, gm.patient_id, p.name, p.status, p.payment_type, p.default_session_price_cents,
                       bp.billing_type
                FROM therapy_group_members gm
                JOIN psychotherapy_patients p ON p.id = gm.patient_id
                LEFT JOIN therapy_group_member_billing_policies bp 
                  ON bp.member_id = gm.id 
                 AND bp.status = 'active'
                 AND bp.valid_from <= $4::date
                 AND (bp.valid_until IS NULL OR bp.valid_until >= $4::date)
                WHERE gm.group_id = $1
                  AND gm.id = ANY($2::uuid[])
                  AND gm.left_at IS NULL
                  AND p.tenant_id = $3;
            `, [groupId, groupMemberIds, tenantId, sessionDate]);

            const memberMap = new Map<string, {
                patientId: string;
                name: string;
                status: string;
                paymentType: string | null;
                defaultPriceCents: number | null;
                billingType: string | null;
            }>();
            for (const row of membersResult.rows) {
                memberMap.set(row.group_member_id, {
                    patientId: row.patient_id,
                    name: row.name,
                    status: row.status,
                    paymentType: row.payment_type,
                    defaultPriceCents: row.default_session_price_cents,
                    billingType: row.billing_type,
                });
            }

            const nonMembers = groupMemberIds.filter(id => !memberMap.has(id));
            if (nonMembers.length > 0) {
                throw new AppError(
                    `As seguintes matrículas não são ativas ou não foram encontradas: ${nonMembers.join(', ')}`,
                    400
                );
            }

            // ── 4. Processar cada membro na transação ─────────────────────────
            const records: GroupSessionRecord[] = [];
            let appointmentsProcessed = 0;

            const calendarEventId = await this.upsertGroupCalendarEvent(client, {
                tenantId,
                groupId,
                scheduledAt,
                durationMinutes,
            });

            for (const attendance of attendances) {
                const member = memberMap.get(attendance.groupMemberId)!;
                if (!member.billingType) {
                    throw new AppError(`Matrícula ${attendance.groupMemberId} não possui política de faturamento na data da sessão.`, 500);
                }

                const effectivePriceCents =
                    attendance.sessionPriceCentsOverride ?? member.defaultPriceCents ?? groupPriceCents;

                const appointmentId = await this.upsertGroupAppointment(client, {
                    tenantId,
                    patientId: member.patientId,
                    groupId,
                    scheduledAt,
                    durationMinutes,
                    attendanceStatus: attendance.status,
                    notes: attendance.notes ?? sessionNotes ?? null,
                    calendarEventId,
                });
                appointmentsProcessed++;

                const recordResult = await client.query(`
                    INSERT INTO group_session_records (
                        id, tenant_id, group_id, session_date,
                        patient_id, appointment_id, attendance_status,
                        notes, session_price_cents, group_member_id
                    ) VALUES (
                        gen_random_uuid(), $1, $2, $3::date,
                        $4, $5, $6,
                        $7, $8, $9
                    )
                    ON CONFLICT ON CONSTRAINT uq_group_session_patient
                    DO UPDATE SET
                        attendance_status  = EXCLUDED.attendance_status,
                        appointment_id     = COALESCE(EXCLUDED.appointment_id, group_session_records.appointment_id),
                        notes              = EXCLUDED.notes,
                        session_price_cents = EXCLUDED.session_price_cents,
                        group_member_id    = EXCLUDED.group_member_id,
                        updated_at         = NOW()
                    RETURNING *;
                `, [
                    tenantId, groupId, sessionDate,
                    member.patientId, appointmentId, attendance.status,
                    attendance.notes ?? sessionNotes ?? null,
                    attendance.sessionPriceCentsOverride ?? null,
                    attendance.groupMemberId
                ]);

                const row = recordResult.rows[0];
                const sessionRecordId = row.id;
                records.push(new GroupSessionRecord(
                    sessionRecordId, row.tenant_id, row.group_id,
                    row.session_date, row.patient_id,
                    row.appointment_id, row.attendance_status,
                    row.notes, row.session_price_cents,
                    row.created_at, row.updated_at,
                    row.group_member_id
                ));

                const isBillable = attendance.status === 'present' || attendance.status === 'absent';
                const hasMonthlyFee = group.monthly_fee_cents !== null && group.monthly_fee_cents > 0;
                
                // Se a política é 'group_default' E o grupo não cobra mensalidade, cobramos por sessão.
                if (!hasMonthlyFee && member.billingType === 'group_default') {
                    if (isBillable) {
                        await this.upsertPendingGroupCharge(client, {
                            tenantId,
                            groupId,
                            patientId: member.patientId,
                            groupMemberId: attendance.groupMemberId,
                            sessionRecordId,
                            amountCents: effectivePriceCents,
                            sessionDate,
                        });
                    } else if (attendance.status === 'excused') {
                        await this.voidPendingGroupCharge(client, {
                            tenantId,
                            sessionRecordId,
                        });
                    }
                }
            }

            await client.query('COMMIT');

            logger.info({
                tenantId, groupId, sessionDate,
                members: attendances.length,
            }, '✅ Sessão de grupo registrada com sucesso.');

            return {
                groupId,
                sessionDate,
                records,
                appointmentsProcessed,
            };

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error({ error, tenantId, groupId, sessionDate }, '❌ Erro ao registrar sessão de grupo. ROLLBACK executado.');
            throw error;
        } finally {
            client.release();
        }
    }

    // ── Helpers privados ──────────────────────────────────────────────────────

    private async upsertGroupCalendarEvent(
        client: PoolClient,
        params: {
            tenantId: string;
            groupId: string;
            scheduledAt: Date;
            durationMinutes: number;
        }
    ): Promise<string> {
        const endedAt = new Date(params.scheduledAt.getTime() + params.durationMinutes * 60_000);

        const insertResult = await client.query(`
            INSERT INTO calendar_events (
                id, tenant_id, scheduled_at, ended_at, duration_minutes,
                event_type, status, group_id
            ) VALUES (
                gen_random_uuid(), $1, $2, $3, $4,
                'group', 'completed', $5
            )
            ON CONFLICT (tenant_id, group_id, scheduled_at)
            WHERE event_type = 'group'
            DO NOTHING
            RETURNING id;
        `, [params.tenantId, params.scheduledAt, endedAt, params.durationMinutes, params.groupId]);

        if (insertResult.rows.length > 0) {
            return insertResult.rows[0].id;
        }

        const selectResult = await client.query(`
            SELECT id FROM calendar_events
            WHERE tenant_id  = $1
              AND group_id   = $2
              AND scheduled_at = $3
              AND event_type = 'group'
            LIMIT 1;
        `, [params.tenantId, params.groupId, params.scheduledAt]);

        if (selectResult.rows.length === 0) {
            throw new AppError(
                'Falha interna: não foi possível criar nem localizar o evento de calendário da sessão.',
                500
            );
        }
        return selectResult.rows[0].id;
    }

    private async upsertGroupAppointment(
        client: PoolClient,
        params: {
            tenantId: string;
            patientId: string;
            groupId: string;
            scheduledAt: Date;
            durationMinutes: number;
            attendanceStatus: GroupAttendanceStatus;
            notes: string | null;
            calendarEventId: string;
        }
    ): Promise<string> {
        const appointmentStatus =
            params.attendanceStatus === 'present' ? 'attended' :
            params.attendanceStatus === 'absent'  ? 'no_show' :
            'canceled'; 

        const result = await client.query(`
            INSERT INTO psychotherapy_appointments (
                id, tenant_id, patient_id, group_id,
                scheduled_at, duration_minutes,
                status, recurrence, notes, calendar_event_id
            ) VALUES (
                gen_random_uuid(), $1, $2, $3,
                $4, $5,
                $6, 'none', $7, $8
            )
            ON CONFLICT (tenant_id, patient_id, group_id, scheduled_at)
            WHERE group_id IS NOT NULL
            DO UPDATE SET
                status     = EXCLUDED.status,
                notes      = COALESCE(EXCLUDED.notes, psychotherapy_appointments.notes),
                updated_at = NOW()
            RETURNING id;
        `, [
            params.tenantId, params.patientId, params.groupId,
            params.scheduledAt, params.durationMinutes,
            appointmentStatus, params.notes, params.calendarEventId,
        ]);

        return result.rows[0].id;
    }

    private async upsertPendingGroupCharge(
        client: PoolClient,
        params: {
            tenantId: string;
            groupId: string;
            patientId: string;
            groupMemberId: string;
            sessionRecordId: string;
            amountCents: number;
            sessionDate: string;
        }
    ): Promise<void> {
        const existing = await client.query(`
            SELECT id, status FROM group_payments
            WHERE tenant_id = $1 AND group_session_record_id = $2
            LIMIT 1;
        `, [params.tenantId, params.sessionRecordId]);

        if (existing.rows.length > 0) {
            const row = existing.rows[0];
            if (row.status === 'paid') {
                throw new AppError(`A sessão da matrícula já foi paga e não pode ser re-criada automaticamente. Use estorno manual.`, 409);
            }
            if (row.status === 'voided') {
                // não faz nada
            } else {
                await client.query(`
                    UPDATE group_payments
                    SET amount_cents = $1, updated_at = NOW()
                    WHERE id = $2 AND status = 'pending';
                `, [params.amountCents, row.id]);
                return;
            }
        }

        await client.query(`
            INSERT INTO group_payments (
                id, tenant_id, group_id, patient_id, group_member_id,
                charge_type, reference_month, amount_cents, original_amount_cents,
                status, due_date, group_session_record_id
            ) VALUES (
                gen_random_uuid(), $1, $2, $3, $4,
                'session', $5, $6, $6,
                'pending', $7::date, $8
            )
        `, [
            params.tenantId, params.groupId, params.patientId, params.groupMemberId,
            params.sessionDate.slice(0, 7), 
            params.amountCents,
            params.sessionDate, 
            params.sessionRecordId
        ]);
    }

    private async voidPendingGroupCharge(
        client: PoolClient,
        params: {
            tenantId: string;
            sessionRecordId: string;
        }
    ): Promise<void> {
        const existing = await client.query(`
            SELECT id, status FROM group_payments
            WHERE tenant_id = $1 AND group_session_record_id = $2
            LIMIT 1;
        `, [params.tenantId, params.sessionRecordId]);

        if (existing.rows.length > 0) {
            const row = existing.rows[0];
            if (row.status === 'paid') {
                throw new AppError(`A sessão justificada já possui pagamento registrado. É necessário estorná-lo manualmente.`, 409);
            }
            
            await client.query(`
                UPDATE group_payments
                SET status = 'voided', voided_at = NOW(), void_reason = 'Falta justificada na sessão', updated_at = NOW()
                WHERE id = $1;
            `, [row.id]);
        }
    }
}
