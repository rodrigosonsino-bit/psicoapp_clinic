import { injectable, inject } from 'tsyringe';
import { Pool, PoolClient } from 'pg';
import { AppError } from '../../domain/errors/AppError';
import { NotFoundError } from '../../domain/errors/NotFoundError';
import { GroupAttendanceStatus, GroupSessionRecord, groupSessionDatetime } from '../../domain/models/TherapyGroup';
import { logger } from '../../infrastructure/logger';

// ── DTOs públicos ────────────────────────────────────────────────────────────

export interface GroupMemberAttendance {
    patientId: string;
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
    /** Registros mensais de faturamento atualizados */
    monthlyRecordsUpdated: number;
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
        if (attendances.some(a => !a.patientId)) {
            throw new AppError('Cada presença deve ter um patientId válido.', 400);
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
                SELECT id, name, session_price_cents, start_time, duration_minutes, is_active, deleted_at
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
            // "2025-06-10" + "14:00" → new Date("2025-06-10T14:00:00-03:00")
            // Garante que em servidor UTC, o horário seja preservado corretamente.
            const scheduledAt = groupSessionDatetime(sessionDate, startTimeHHMM);

            // ── 3. Verificar que todos os pacientes são membros ativos do grupo ─
            const patientIds = attendances.map(a => a.patientId);
            const membersResult = await client.query(`
                SELECT gm.patient_id, p.name, p.status, p.payment_type, p.default_session_price_cents
                FROM therapy_group_members gm
                JOIN psychotherapy_patients p ON p.id = gm.patient_id
                WHERE gm.group_id = $1
                  AND gm.patient_id = ANY($2::uuid[])
                  AND gm.left_at IS NULL
                  AND p.tenant_id = $3;
            `, [groupId, patientIds, tenantId]);

            const memberMap = new Map<string, {
                name: string;
                status: string;
                paymentType: string | null;
                defaultPriceCents: number | null;
            }>();
            for (const row of membersResult.rows) {
                memberMap.set(row.patient_id, {
                    name: row.name,
                    status: row.status,
                    paymentType: row.payment_type,
                    defaultPriceCents: row.default_session_price_cents,
                });
            }

            const nonMembers = patientIds.filter(id => !memberMap.has(id));
            if (nonMembers.length > 0) {
                throw new AppError(
                    `Os seguintes pacientes não são membros ativos do grupo: ${nonMembers.join(', ')}`,
                    400
                );
            }

            // ── 4. Processar cada membro na transação ─────────────────────────
            const records: GroupSessionRecord[] = [];
            let appointmentsProcessed = 0;
            let monthlyRecordsUpdated = 0;

            for (const attendance of attendances) {
                const member = memberMap.get(attendance.patientId)!;
                const effectivePriceCents =
                    attendance.sessionPriceCentsOverride ?? member.defaultPriceCents ?? groupPriceCents;

                // 4a. Criar ou atualizar appointment individual do paciente
                const appointmentId = await this.upsertGroupAppointment(client, {
                    tenantId,
                    patientId: attendance.patientId,
                    groupId,
                    scheduledAt,
                    durationMinutes,
                    attendanceStatus: attendance.status,
                    notes: attendance.notes ?? sessionNotes ?? null,
                });
                appointmentsProcessed++;

                // 4b. Registrar presença com idempotência (ON CONFLICT DO UPDATE)
                const recordResult = await client.query(`
                    INSERT INTO group_session_records (
                        id, tenant_id, group_id, session_date,
                        patient_id, appointment_id, attendance_status,
                        notes, session_price_cents
                    ) VALUES (
                        gen_random_uuid(), $1, $2, $3::date,
                        $4, $5, $6,
                        $7, $8
                    )
                    ON CONFLICT ON CONSTRAINT uq_group_session_patient
                    DO UPDATE SET
                        attendance_status  = EXCLUDED.attendance_status,
                        appointment_id     = COALESCE(EXCLUDED.appointment_id, group_session_records.appointment_id),
                        notes              = EXCLUDED.notes,
                        session_price_cents = EXCLUDED.session_price_cents,
                        updated_at         = NOW()
                    RETURNING *;
                `, [
                    tenantId, groupId, sessionDate,
                    attendance.patientId, appointmentId, attendance.status,
                    attendance.notes ?? sessionNotes ?? null,
                    attendance.sessionPriceCentsOverride ?? null,
                ]);

                const row = recordResult.rows[0];
                records.push(new GroupSessionRecord(
                    row.id, row.tenant_id, row.group_id,
                    row.session_date, row.patient_id,
                    row.appointment_id, row.attendance_status,
                    row.notes, row.session_price_cents,
                    row.created_at, row.updated_at
                ));

                // 4c. Atualizar monthly_record de faturamento
                // presente ou falta-não-justificada = sessão cobrada
                const isBillable = attendance.status === 'present' || attendance.status === 'absent';
                await this.upsertMonthlyRecord(client, {
                    tenantId,
                    patientId: attendance.patientId,
                    patientName: member.name,
                    patientStatus: member.status,
                    paymentType: member.paymentType,
                    sessionDate,
                    scheduledAt,
                    sessionPriceCents: effectivePriceCents,
                    isBillable,
                    isAbsence: attendance.status === 'absent',
                });
                monthlyRecordsUpdated++;
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
                monthlyRecordsUpdated,
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

    /**
     * Cria ou atualiza o appointment individual do paciente para esta sessão de grupo.
     * Usa ON CONFLICT na chave (tenant_id, patient_id, scheduled_at) implícita via
     * verificação prévia + upsert, garantindo idempotência.
     *
     * Retorna o UUID do appointment.
     */
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
        }
    ): Promise<string> {
        const appointmentStatus =
            params.attendanceStatus === 'present' ? 'attended' :
            params.attendanceStatus === 'absent'  ? 'no_show' :
            'canceled'; // excused → canceled (não gera cobrança)

        // Verificar se já existe um appointment para este paciente neste horário (grupo)
        const existing = await client.query(`
            SELECT id FROM psychotherapy_appointments
            WHERE tenant_id = $1
              AND patient_id = $2
              AND group_id   = $3
              AND scheduled_at = $4
            LIMIT 1;
        `, [params.tenantId, params.patientId, params.groupId, params.scheduledAt]);

        if (existing.rows.length > 0) {
            // Atualizar status do existente
            await client.query(`
                UPDATE psychotherapy_appointments
                SET status = $1, notes = COALESCE($2, notes), updated_at = NOW()
                WHERE id = $3;
            `, [appointmentStatus, params.notes, existing.rows[0].id]);
            return existing.rows[0].id;
        }

        // Inserir novo appointment
        const result = await client.query(`
            INSERT INTO psychotherapy_appointments (
                id, tenant_id, patient_id, group_id,
                scheduled_at, duration_minutes,
                status, recurrence, notes
            ) VALUES (
                gen_random_uuid(), $1, $2, $3,
                $4, $5,
                $6, 'none', $7
            )
            RETURNING id;
        `, [
            params.tenantId, params.patientId, params.groupId,
            params.scheduledAt, params.durationMinutes,
            appointmentStatus, params.notes,
        ]);

        return result.rows[0].id;
    }

    /**
     * Insere ou atualiza o registro mensal de faturamento do paciente.
     * Reutiliza exatamente o mesmo padrão de ON CONFLICT do updateAppointmentStatus
     * do repositório — garante consistência total com o faturamento individual.
     */
    private async upsertMonthlyRecord(
        client: PoolClient,
        params: {
            tenantId: string;
            patientId: string;
            patientName: string;
            patientStatus: string;
            paymentType: string | null;
            sessionDate: string;
            scheduledAt: Date;
            sessionPriceCents: number;
            isBillable: boolean;
            isAbsence: boolean;
        }
    ): Promise<void> {
        const monthStr = toMonthStrBRT(params.scheduledAt);

        // Para pacientes mensais, não incrementamos expected_sessions (já está fixo no gerador do mês)
        const deltaExpected = params.paymentType === 'monthly' ? 0 : (params.isBillable ? 1 : 0);
        const deltaAbsences = params.isAbsence ? 1 : 0;

        // Só dispara se houver impacto real no faturamento
        if (deltaExpected === 0 && deltaAbsences === 0 && !params.isBillable) return;

        const initExpected = params.paymentType === 'monthly' ? 0 : (params.isBillable ? 1 : 0);
        const initAbsences = params.isAbsence ? 1 : 0;

        await client.query(`
            INSERT INTO psychotherapy_monthly_records (
                id, tenant_id, patient_id, month,
                patient_name_snapshot, status, payment_type,
                session_price_cents, expected_sessions, absences,
                paid_sessions, payment_status, previous_month_paid_cents
            ) VALUES (
                gen_random_uuid(), $1, $2, $3,
                $4, $5, $6,
                $7, $8, $9,
                0, 'pending', 0
            )
            ON CONFLICT (tenant_id, month, patient_id)
            WHERE patient_id IS NOT NULL
            DO UPDATE SET
                expected_sessions = GREATEST(
                    psychotherapy_monthly_records.expected_sessions + $10, 0),
                absences = GREATEST(
                    psychotherapy_monthly_records.absences + $11, 0),
                payment_status = CASE
                    WHEN psychotherapy_monthly_records.paid_sessions >= GREATEST(
                        psychotherapy_monthly_records.expected_sessions + $10
                        - GREATEST(psychotherapy_monthly_records.absences + $11, 0), 0)
                    THEN 'paid'
                    WHEN psychotherapy_monthly_records.paid_sessions > 0 THEN 'partial'
                    ELSE 'pending'
                END,
                updated_at = NOW();
        `, [
            params.tenantId, params.patientId, monthStr,
            params.patientName, params.patientStatus, params.paymentType,
            params.sessionPriceCents, initExpected, initAbsences,
            deltaExpected, deltaAbsences,
        ]);
    }
}
