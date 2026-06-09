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
                tg.monthly_fee_cents,
                tg.start_date,
                tg.duration_months,
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

    /** POST /psychotherapy/groups */
    async createGroup(req: Request, res: Response): Promise<void> {
        const tenantId = (req as any).tenantId as string;
        if (!tenantId) throw new AppError('Não autenticado', 401);

        const {
            name,
            description,
            monthly_fee_cents,
            day_of_week,
            start_time,
            duration_minutes,
            start_date,
            duration_months
        } = req.body;

        const result = await this.dbPool.query(`
            INSERT INTO therapy_groups
                (tenant_id, name, description, monthly_fee_cents,
                 day_of_week, start_time, duration_minutes, start_date, duration_months)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *;
        `, [
            tenantId,
            name,
            description ?? null,
            monthly_fee_cents,
            day_of_week ?? null,
            start_time ?? null,
            duration_minutes ?? 90,
            start_date ?? null,
            duration_months ?? null
        ]);

        res.status(201).json({
            success: true,
            data: result.rows[0]
        });
    }

    /** PUT /psychotherapy/groups/:groupId */
    async updateGroup(req: Request, res: Response): Promise<void> {
        const tenantId = (req as any).tenantId as string;
        if (!tenantId) throw new AppError('Não autenticado', 401);

        const { groupId } = req.params;
        const {
            name,
            description,
            monthly_fee_cents,
            day_of_week,
            start_time,
            duration_minutes,
            start_date,
            duration_months,
            is_active
        } = req.body;

        const groupCheck = await this.dbPool.query(
            'SELECT id FROM therapy_groups WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
            [groupId, tenantId]
        );
        if (groupCheck.rows.length === 0) {
            throw new AppError('Grupo não encontrado', 404);
        }

        const fields: string[] = [];
        const values: any[] = [];
        let idx = 1;

        const addField = (fieldName: string, value: any) => {
            if (value !== undefined) {
                fields.push(`${fieldName} = $${idx++}`);
                values.push(value);
            }
        };

        addField('name', name);
        addField('description', description);
        addField('monthly_fee_cents', monthly_fee_cents);
        addField('day_of_week', day_of_week);
        addField('start_time', start_time);
        addField('duration_minutes', duration_minutes);
        addField('start_date', start_date);
        addField('duration_months', duration_months);
        addField('is_active', is_active);

        if (fields.length === 0) {
            throw new AppError('Nenhum campo para atualizar', 400);
        }

        values.push(groupId, tenantId);
        const query = `
            UPDATE therapy_groups
            SET ${fields.join(', ')}, updated_at = NOW()
            WHERE id = $${idx++} AND tenant_id = $${idx++}
            RETURNING *;
        `;

        const result = await this.dbPool.query(query, values);

        res.status(200).json({
            success: true,
            data: result.rows[0]
        });
    }

    /** DELETE /psychotherapy/groups/:groupId */
    async deleteGroup(req: Request, res: Response): Promise<void> {
        const tenantId = (req as any).tenantId as string;
        if (!tenantId) throw new AppError('Não autenticado', 401);

        const { groupId } = req.params;

        const groupCheck = await this.dbPool.query(
            'SELECT id FROM therapy_groups WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
            [groupId, tenantId]
        );
        if (groupCheck.rows.length === 0) {
            throw new AppError('Grupo não encontrado', 404);
        }

        await this.dbPool.query(`
            UPDATE therapy_groups
            SET deleted_at = NOW(), is_active = FALSE
            WHERE id = $1 AND tenant_id = $2;
        `, [groupId, tenantId]);

        res.status(200).json({ success: true });
    }

    /** GET /psychotherapy/groups/:groupId/payments?month=YYYY-MM */
    async listGroupPayments(req: Request, res: Response): Promise<void> {
        const tenantId = (req as any).tenantId as string;
        if (!tenantId) throw new AppError('Não autenticado', 401);

        const { groupId } = req.params;
        const { month } = req.query as { month?: string };

        const effectiveMonth = month ?? new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Sao_Paulo',
            year: 'numeric',
            month: '2-digit',
        }).format(new Date()).slice(0, 7);

        const groupCheck = await this.dbPool.query(
            'SELECT id FROM therapy_groups WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
            [groupId, tenantId]
        );
        if (groupCheck.rows.length === 0) {
            throw new AppError('Grupo não encontrado', 404);
        }

        const result = await this.dbPool.query(`
            SELECT
                p.id            AS patient_id,
                p.name,
                COALESCE(SUM(gp.amount_cents), 0)::int   AS total_paid_cents,
                COUNT(gp.id)::int                        AS payments_count,
                MAX(gp.total_installments)               AS total_installments,
                tg.monthly_fee_cents,
                CASE
                    WHEN tg.monthly_fee_cents IS NULL OR tg.monthly_fee_cents = 0 THEN 'paid'
                    WHEN COALESCE(SUM(gp.amount_cents), 0) = 0                    THEN 'pending'
                    WHEN COALESCE(SUM(gp.amount_cents), 0) >= tg.monthly_fee_cents THEN 'paid'
                    ELSE 'partial'
                END AS payment_status,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'id', gp.id,
                            'amount_cents', gp.amount_cents,
                            'payment_method', gp.payment_method,
                            'total_installments', gp.total_installments,
                            'installment_number', gp.installment_number,
                            'installment_group_id', gp.installment_group_id,
                            'paid_at', gp.paid_at,
                            'notes', gp.notes
                        )
                    ) FILTER (WHERE gp.id IS NOT NULL),
                    '[]'::json
                ) AS payments
            FROM therapy_group_members tgm
            JOIN psychotherapy_patients p  ON p.id  = tgm.patient_id
            JOIN therapy_groups tg         ON tg.id = tgm.group_id
            LEFT JOIN group_payments gp
                ON  gp.group_id        = tgm.group_id
                AND gp.patient_id      = tgm.patient_id
                AND gp.reference_month = $1
                AND gp.tenant_id       = $2
            WHERE tgm.group_id   = $3
              AND tgm.left_at   IS NULL
              AND p.tenant_id    = $2
            GROUP BY p.id, p.name, tg.monthly_fee_cents
            ORDER BY p.name ASC;
        `, [effectiveMonth, tenantId, groupId]);

        res.status(200).json({
            success: true,
            data: result.rows,
            meta: { month: effectiveMonth }
        });
    }

    /** POST /psychotherapy/groups/:groupId/payments */
    async registerPayment(req: Request, res: Response): Promise<void> {
        const tenantId = (req as any).tenantId as string;
        if (!tenantId) throw new AppError('Não autenticado', 401);

        const { groupId } = req.params;
        const {
            patient_id,
            reference_month,
            amount_cents,
            payment_method,
            total_installments,
            notes
        } = req.body;

        const groupCheck = await this.dbPool.query(
            'SELECT id FROM therapy_groups WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
            [groupId, tenantId]
        );
        if (groupCheck.rows.length === 0) {
            throw new AppError('Grupo não encontrado', 404);
        }

        const memberCheck = await this.dbPool.query(
            'SELECT id FROM therapy_group_members WHERE group_id = $1 AND patient_id = $2 AND left_at IS NULL',
            [groupId, patient_id]
        );
        if (memberCheck.rows.length === 0) {
            throw new AppError('Paciente não é membro ativo deste grupo', 400);
        }

        const client = await this.dbPool.connect();

        try {
            await client.query('BEGIN');

            const insertedPayments: any[] = [];

            if (payment_method === 'credit_card' && total_installments > 1) {
                const crypto = require('crypto');
                const installmentGroupId = crypto.randomUUID ? crypto.randomUUID() : require('crypto').randomUUID();

                for (let i = 0; i < total_installments; i++) {
                    const instNum = i + 1;
                    const refMonth = addMonths(reference_month, i);

                    try {
                        const insertRes = await client.query(`
                            INSERT INTO group_payments (
                                tenant_id, group_id, patient_id, reference_month,
                                amount_cents, payment_method, total_installments,
                                installment_number, installment_group_id, notes
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                            RETURNING *;
                        `, [
                            tenantId,
                            groupId,
                            patient_id,
                            refMonth,
                            amount_cents,
                            payment_method,
                            total_installments,
                            instNum,
                            installmentGroupId,
                            notes ?? null
                        ]);
                        insertedPayments.push(insertRes.rows[0]);
                    } catch (err: any) {
                        if (err.code === '23505') {
                            throw new AppError(`A parcela ${instNum} (${refMonth}) já foi registrada para este paciente.`, 409);
                        }
                        throw err;
                    }
                }
            } else {
                try {
                    const insertRes = await client.query(`
                        INSERT INTO group_payments (
                            tenant_id, group_id, patient_id, reference_month,
                            amount_cents, payment_method, total_installments,
                            installment_number, notes
                        ) VALUES ($1, $2, $3, $4, $5, $6, 1, 1, $7)
                        RETURNING *;
                    `, [
                        tenantId,
                        groupId,
                        patient_id,
                        reference_month,
                        amount_cents,
                        payment_method,
                        notes ?? null
                    ]);
                    insertedPayments.push(insertRes.rows[0]);
                } catch (err: any) {
                    if (err.code === '23505') {
                        throw new AppError('Esta parcela já foi registrada.', 409);
                    }
                    throw err;
                }
            }

            await client.query('COMMIT');

            res.status(201).json({
                success: true,
                data: insertedPayments
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /** DELETE /psychotherapy/groups/:groupId/payments/:paymentId */
    async deletePayment(req: Request, res: Response): Promise<void> {
        const tenantId = (req as any).tenantId as string;
        if (!tenantId) throw new AppError('Não autenticado', 401);

        const { groupId, paymentId } = req.params;
        const { mode } = req.query as { mode?: 'single' | 'all' };

        const groupCheck = await this.dbPool.query(
            'SELECT id FROM therapy_groups WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
            [groupId, tenantId]
        );
        if (groupCheck.rows.length === 0) {
            throw new AppError('Grupo não encontrado', 404);
        }

        const paymentResult = await this.dbPool.query(
            'SELECT id, installment_group_id FROM group_payments WHERE id = $1 AND group_id = $2 AND tenant_id = $3',
            [paymentId, groupId, tenantId]
        );
        if (paymentResult.rows.length === 0) {
            throw new AppError('Pagamento não encontrado', 404);
        }

        const payment = paymentResult.rows[0];

        if (mode === 'all' && payment.installment_group_id) {
            await this.dbPool.query(
                'DELETE FROM group_payments WHERE installment_group_id = $1 AND group_id = $2 AND tenant_id = $3',
                [payment.installment_group_id, groupId, tenantId]
            );
        } else {
            await this.dbPool.query(
                'DELETE FROM group_payments WHERE id = $1 AND group_id = $2 AND tenant_id = $3',
                [paymentId, groupId, tenantId]
            );
        }

        res.status(200).json({ success: true });
    }
}

function addMonths(monthStr: string, monthsToAdd: number): string {
    const [year, month] = monthStr.split('-').map(Number);
    const date = new Date(year, month - 1 + monthsToAdd, 1);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}
