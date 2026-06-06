import { Request, Response } from 'express';
import { injectable, inject } from 'tsyringe';
import { Pool } from 'pg';
import { RegisterGroupSessionUseCase } from '../../application/useCases/RegisterGroupSessionUseCase';
import { AppError } from '../../domain/errors/AppError';
import { logger } from '../../infrastructure/logger';

@injectable()
export class GroupController {
    constructor(
        @inject(Pool) private readonly dbPool: Pool,
        @inject(RegisterGroupSessionUseCase) private readonly registerSession: RegisterGroupSessionUseCase,
    ) {}

    /** POST /psychotherapy/groups/:groupId/sessions */
    async registerGroupSession(req: Request, res: Response): Promise<void> {
        const tenantId = (req as any).tenantId as string;
        if (!tenantId) throw new AppError('Não autenticado', 401);

        const { groupId } = req.params;
        const { sessionDate, attendances, sessionNotes } = req.body;

        const result = await this.registerSession.execute({
            tenantId,
            groupId,
            sessionDate,
            attendances,
            sessionNotes: sessionNotes ?? null,
        });

        logger.info({ tenantId, groupId, sessionDate, count: result.records.length },
            'POST /groups/:groupId/sessions → sessão de grupo registrada');

        res.status(200).json({
            success: true,
            data: result,
        });
    }

    /** GET /psychotherapy/groups/:groupId/sessions */
    async listGroupSessions(req: Request, res: Response): Promise<void> {
        const tenantId = (req as any).tenantId as string;
        if (!tenantId) throw new AppError('Não autenticado', 401);

        const { groupId } = req.params;
        const { month } = req.query as { month?: string };

        let dateFilter = '';
        const params: unknown[] = [tenantId, groupId];

        if (month && /^\d{4}-\d{2}$/.test(month)) {
            params.push(`${month}-01`);
            dateFilter = `AND gsr.session_date >= $3::date AND gsr.session_date < ($3::date + INTERVAL '1 month')`;
        }

        const result = await this.dbPool.query(`
            SELECT
                gsr.id,
                gsr.session_date,
                gsr.patient_id,
                p.name          AS patient_name,
                gsr.attendance_status,
                gsr.notes,
                gsr.session_price_cents,
                gsr.appointment_id,
                -- Status de pagamento do mês corrente
                pmr.payment_status,
                pmr.paid_sessions,
                pmr.expected_sessions,
                pmr.absences
            FROM group_session_records gsr
            JOIN psychotherapy_patients p ON p.id = gsr.patient_id
            LEFT JOIN psychotherapy_monthly_records pmr
                ON pmr.tenant_id = gsr.tenant_id
               AND pmr.patient_id = gsr.patient_id
               AND pmr.month = TO_CHAR(gsr.session_date, 'YYYY-MM')
            WHERE gsr.tenant_id = $1
              AND gsr.group_id  = $2
              ${dateFilter}
            ORDER BY gsr.session_date DESC, p.name ASC;
        `, params);

        res.status(200).json({
            success: true,
            data: result.rows,
        });
    }

    /** GET /psychotherapy/groups */
    async listGroups(req: Request, res: Response): Promise<void> {
        const tenantId = (req as any).tenantId as string;
        if (!tenantId) throw new AppError('Não autenticado', 401);

        const { includeInactive } = req.query as { includeInactive?: string };
        const showAll = includeInactive === 'true';

        const result = await this.dbPool.query(`
            SELECT
                tg.id,
                tg.name,
                tg.description,
                tg.session_price_cents,
                tg.day_of_week,
                tg.start_time,
                tg.duration_minutes,
                tg.is_active,
                tg.created_at,
                -- Contagem de membros ativos
                COUNT(DISTINCT tgm.patient_id) FILTER (WHERE tgm.left_at IS NULL) AS member_count
            FROM therapy_groups tg
            LEFT JOIN therapy_group_members tgm ON tgm.group_id = tg.id
            WHERE tg.tenant_id = $1
              AND tg.deleted_at IS NULL
              ${showAll ? '' : 'AND tg.is_active = TRUE'}
            GROUP BY tg.id
            ORDER BY tg.name ASC;
        `, [tenantId]);

        res.status(200).json({
            success: true,
            data: result.rows,
        });
    }

    /** GET /psychotherapy/groups/:groupId/members */
    async listGroupMembers(req: Request, res: Response): Promise<void> {
        const tenantId = (req as any).tenantId as string;
        if (!tenantId) throw new AppError('Não autenticado', 401);

        const { groupId } = req.params;
        const { month } = req.query as { month?: string };

        // month padrão = mês atual em BRT
        const effectiveMonth = month ?? new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Sao_Paulo',
            year: 'numeric',
            month: '2-digit',
        }).format(new Date()).slice(0, 7);

        const result = await this.dbPool.query(`
            SELECT
                p.id            AS patient_id,
                p.name,
                p.phone,
                p.payment_type,
                p.default_session_price_cents,
                p.status        AS patient_status,
                tgm.joined_at,
                tgm.left_at,
                -- Indicadores de pagamento do mês: 🟢 pago, 🟡 parcial, 🔴 pendente
                COALESCE(pmr.payment_status, 'pending') AS payment_status,
                COALESCE(pmr.paid_sessions,  0)         AS paid_sessions,
                COALESCE(pmr.expected_sessions, 0)      AS expected_sessions,
                COALESCE(pmr.absences, 0)               AS absences
            FROM therapy_group_members tgm
            JOIN psychotherapy_patients p ON p.id = tgm.patient_id
            LEFT JOIN psychotherapy_monthly_records pmr
                ON pmr.tenant_id  = p.tenant_id
               AND pmr.patient_id = p.id
               AND pmr.month      = $3
            WHERE tgm.group_id   = $1
              AND p.tenant_id    = $2
              AND tgm.left_at IS NULL
            ORDER BY p.name ASC;
        `, [groupId, tenantId, effectiveMonth]);

        res.status(200).json({
            success: true,
            data: result.rows,
            meta: { month: effectiveMonth },
        });
    }
    /** POST /psychotherapy/groups/:groupId/members */
    async addGroupMember(req: Request, res: Response): Promise<void> {
        const tenantId = (req as any).tenantId as string;
        if (!tenantId) throw new AppError('Não autenticado', 401);

        const { groupId } = req.params;
        const { patientId } = req.body;

        if (!patientId) {
            throw new AppError('patientId é obrigatório', 400);
        }

        // Verifica se o grupo pertence ao tenant
        const groupCheck = await this.dbPool.query('SELECT id FROM therapy_groups WHERE id = $1 AND tenant_id = $2', [groupId, tenantId]);
        if (groupCheck.rows.length === 0) {
            throw new AppError('Grupo não encontrado', 404);
        }

        // Verifica se o paciente pertence ao tenant
        const patientCheck = await this.dbPool.query('SELECT id FROM psychotherapy_patients WHERE id = $1 AND tenant_id = $2', [patientId, tenantId]);
        if (patientCheck.rows.length === 0) {
            throw new AppError('Paciente não encontrado', 404);
        }

        try {
            await this.dbPool.query(`
                INSERT INTO therapy_group_members (group_id, patient_id)
                VALUES ($1, $2)
                ON CONFLICT (group_id, patient_id) DO UPDATE SET left_at = NULL
            `, [groupId, patientId]);
            
            res.status(201).json({ success: true, message: 'Paciente adicionado ao grupo' });
        } catch (error: any) {
            logger.error({ tenantId, groupId, patientId, err: error.message }, 'Erro ao adicionar membro');
            throw new AppError('Erro ao vincular paciente ao grupo', 500);
        }
    }

    /** DELETE /psychotherapy/groups/:groupId/members/:patientId */
    async removeGroupMember(req: Request, res: Response): Promise<void> {
        const tenantId = (req as any).tenantId as string;
        if (!tenantId) throw new AppError('Não autenticado', 401);

        const { groupId, patientId } = req.params;

        // Verifica se o grupo pertence ao tenant
        const groupCheck = await this.dbPool.query('SELECT id FROM therapy_groups WHERE id = $1 AND tenant_id = $2', [groupId, tenantId]);
        if (groupCheck.rows.length === 0) {
            throw new AppError('Grupo não encontrado', 404);
        }

        // Soft delete (marcar left_at) ou deletar hard?
        // A migration usava ON DELETE CASCADE, mas o ideal é preencher left_at para manter histórico se o paciente sair do grupo?
        // Vamos apenas deletar hard por agora, seguindo o padrão de simplificação, ou setar left_at = NOW() se preferir histórico.
        // O select de list members filtra "WHERE tgm.left_at IS NULL" então left_at = NOW() é o mais seguro clinicamente.
        
        await this.dbPool.query(`
            UPDATE therapy_group_members
            SET left_at = CURRENT_DATE
            WHERE group_id = $1 AND patient_id = $2
        `, [groupId, patientId]);

        res.status(200).json({ success: true, message: 'Paciente removido do grupo' });
    }
}
