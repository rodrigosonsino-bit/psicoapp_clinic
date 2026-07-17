import { Request, Response } from 'express';
import { injectable, inject } from 'tsyringe';
import { Pool } from 'pg';
import crypto from 'crypto';
import { RegisterGroupSessionUseCase } from '../../application/useCases/RegisterGroupSessionUseCase';
import { CreateGroupChargesUseCase } from '../../application/useCases/CreateGroupChargesUseCase';
import { ConfirmGroupPaymentUseCase } from '../../application/useCases/ConfirmGroupPaymentUseCase';
import { VoidGroupPaymentUseCase } from '../../application/useCases/VoidGroupPaymentUseCase';
import { ReplaceGroupChargeUseCase } from '../../application/useCases/ReplaceGroupChargeUseCase';
import { AddGroupMemberIdempotentUseCase } from '../../application/useCases/AddGroupMemberIdempotentUseCase';
import { AdvanceInstallmentsUseCase } from '../../application/useCases/AdvanceInstallmentsUseCase';
import { AttachExistingGroupMemberUseCase } from '../../application/useCases/AttachExistingGroupMemberUseCase';
import { CreateUpfrontCourseChargeUseCase } from '../../application/useCases/CreateUpfrontCourseChargeUseCase';
import { RefundUpfrontCourseUseCase } from '../../application/useCases/RefundUpfrontCourseUseCase';
import { CancelPolicyUseCase } from '../../application/useCases/CancelPolicyUseCase';
import { AppError } from '../../domain/errors/AppError';
import { logger } from '../../infrastructure/logger';

@injectable()
export class GroupController {
    constructor(
        @inject(Pool) private readonly dbPool: Pool,
        @inject(RegisterGroupSessionUseCase) private readonly registerSession: RegisterGroupSessionUseCase,
        @inject(CreateGroupChargesUseCase) private readonly createGroupCharges: CreateGroupChargesUseCase,
        @inject(ConfirmGroupPaymentUseCase) private readonly confirmGroupPayment: ConfirmGroupPaymentUseCase,
        @inject(VoidGroupPaymentUseCase) private readonly voidGroupPayment: VoidGroupPaymentUseCase,
        @inject(ReplaceGroupChargeUseCase) private readonly replaceGroupCharge: ReplaceGroupChargeUseCase,
        @inject(AddGroupMemberIdempotentUseCase) private readonly addGroupMemberIdempotentUseCase: AddGroupMemberIdempotentUseCase,
        @inject(AttachExistingGroupMemberUseCase) private readonly attachExistingGroupMember: AttachExistingGroupMemberUseCase,
        @inject(CreateUpfrontCourseChargeUseCase) private readonly createUpfrontCourseCharge: CreateUpfrontCourseChargeUseCase,
        @inject(RefundUpfrontCourseUseCase) private readonly refundUpfrontCourse: RefundUpfrontCourseUseCase,
        @inject(CancelPolicyUseCase) private readonly cancelPolicy: CancelPolicyUseCase,
        @inject(AdvanceInstallmentsUseCase) private readonly advanceInstallments: AdvanceInstallmentsUseCase
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

    /** POST /psychotherapy/groups/:groupId/members/:memberId/advance-installments */
    async advanceMemberInstallments(req: Request, res: Response): Promise<void> {
        const tenantId = (req as any).tenantId as string;
        if (!tenantId) throw new AppError('Não autenticado', 401);
        const operatorId = (req as any).userId || tenantId;

        const { groupId, memberId } = req.params;
        const { monthsToAdvance, confirmPayment } = req.body;

        const result = await this.advanceInstallments.execute({
            tenantId,
            groupId,
            groupMemberId: memberId,
            monthsToAdvance: Number(monthsToAdvance) || 1
        });

        // Confirmação em lote: opcional, pra marcar como pagas as cobranças que acabaram
        // de ser criadas sem precisar navegar mês a mês confirmando uma a uma. Cada
        // confirmação é uma chamada independente ao mesmo use case do fluxo normal — se
        // uma falhar no meio, as anteriores já ficam pagas e o operador só precisa
        // confirmar manualmente a(s) que sobrou(aram), não há corrupção de estado.
        const confirmedPaymentIds: string[] = [];
        const confirmErrors: Array<{ groupPaymentId: string; message: string }> = [];

        if (confirmPayment && result.createdPaymentIds.length > 0) {
            for (const groupPaymentId of result.createdPaymentIds) {
                try {
                    await this.confirmGroupPayment.execute({
                        tenantId,
                        operatorId,
                        groupPaymentId,
                        paymentMethod: confirmPayment.paymentMethod,
                        amountPaidCents: confirmPayment.amountPaidCents,
                        netAmountCents: confirmPayment.netAmountCents,
                        cardInstallments: confirmPayment.cardInstallments,
                        appliedFeeBps: confirmPayment.appliedFeeBps
                    });
                    confirmedPaymentIds.push(groupPaymentId);
                } catch (err) {
                    confirmErrors.push({
                        groupPaymentId,
                        message: err instanceof AppError ? err.message : 'Erro ao confirmar pagamento.'
                    });
                }
            }
        }

        res.status(201).json({
            success: true,
            data: { ...result, confirmedPaymentIds, confirmErrors }
        });
    }


    /** POST /psychotherapy/groups/:groupId/charges */
    async generateCharges(req: Request, res: Response): Promise<void> {
        const tenantId = (req as any).tenantId as string;
        if (!tenantId) throw new AppError('Não autenticado', 401);

        const { groupId } = req.params;
        const { referenceMonth, dueDate } = req.body;

        const result = await this.createGroupCharges.execute({
            tenantId,
            groupId,
            referenceMonth,
            dueDate
        });

        res.status(201).json({ success: true, data: result });
    }

    /** POST /psychotherapy/group-payments/:id/confirm */
    async confirmPayment(req: Request, res: Response): Promise<void> {
        const tenantId = (req as any).tenantId as string;
        if (!tenantId) throw new AppError('Não autenticado', 401);

        const { id } = req.params;
        const { paymentMethod, amountPaidCents, netAmountCents, observations, cardInstallments, appliedFeeBps } = req.body;

        const operatorId = (req as any).userId || tenantId; // fallback for tests

        await this.confirmGroupPayment.execute({
            tenantId,
            operatorId,
            groupPaymentId: id,
            paymentMethod,
            amountPaidCents,
            netAmountCents,
            observations,
            cardInstallments,
            appliedFeeBps
        });

        res.status(200).json({ success: true });
    }

    /** POST /psychotherapy/group-payments/:id/void */
    async voidPayment(req: Request, res: Response): Promise<void> {
        const tenantId = (req as any).tenantId as string;
        if (!tenantId) throw new AppError('Não autenticado', 401);

        const { id } = req.params;
        const { reason } = req.body;

        await this.voidGroupPayment.execute({
            tenantId,
            groupPaymentId: id,
            reason
        });

        res.status(200).json({ success: true });
    }

    /** POST /psychotherapy/group-payments/:id/replace */
    async replaceCharge(req: Request, res: Response): Promise<void> {
        const tenantId = (req as any).tenantId as string;
        if (!tenantId) throw new AppError('Não autenticado', 401);

        const { id } = req.params;
        const { amountCents, dueDate } = req.body;

        const result = await this.replaceGroupCharge.execute({
            tenantId,
            groupPaymentId: id,
            amountCents,
            dueDate
        });

        res.status(201).json({ success: true, data: result });
    }

    /** POST /psychotherapy/groups/:groupId/members (Anexar membro existente) */
    async addGroupMember(req: Request, res: Response): Promise<void> {
        const tenantId = (req as any).tenantId as string;
        if (!tenantId) throw new AppError('Não autenticado', 401);

        const { groupId } = req.params;
        const { patientId } = req.body;

        const result = await this.attachExistingGroupMember.execute({
            tenantId,
            groupId,
            patientId
        });

        res.status(201).json({ success: true, data: result });
    }

    /** POST /psychotherapy/groups/:groupId/upfront-charge */
    async createUpfrontCharge(req: Request, res: Response): Promise<void> {
        const tenantId = (req as any).tenantId as string;
        const operatorId = (req as any).userId as string; // or whoever is authenticated
        if (!tenantId || !operatorId) throw new AppError('Não autenticado', 401);

        const { groupId } = req.params;
        const { groupMemberId, overrideTotalCents } = req.body;

        const result = await this.createUpfrontCourseCharge.execute({
            tenantId,
            operatorId,
            groupId,
            groupMemberId,
            overrideTotalCents
        });

        res.status(201).json({ success: true, data: result });
    }

    /** POST /psychotherapy/group-payments/:id/refund-upfront */
    async refundUpfrontCharge(req: Request, res: Response): Promise<void> {
        const tenantId = (req as any).tenantId as string;
        const operatorId = (req as any).userId as string;
        if (!tenantId || !operatorId) throw new AppError('Não autenticado', 401);

        const { id } = req.params;
        const { reason } = req.body;

        const result = await this.refundUpfrontCourse.execute({
            tenantId,
            operatorId,
            groupPaymentId: id,
            reason
        });

        res.status(200).json({ success: true, data: result });
    }

    /** POST /psychotherapy/billing-policies/:id/cancel */
    async cancelBillingPolicy(req: Request, res: Response): Promise<void> {
        const tenantId = (req as any).tenantId as string;
        const operatorId = (req as any).userId as string;
        if (!tenantId || !operatorId) throw new AppError('Não autenticado', 401);

        const { id } = req.params;
        const { reason } = req.body;

        await this.cancelPolicy.execute({
            tenantId,
            operatorId,
            policyId: id,
            reason
        });

        res.status(200).json({ success: true });
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
                gsr.group_member_id,
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

    /** GET /psychotherapy/groups/:groupId/eligible-upfront-payments */
    async listEligibleUpfrontPayments(req: Request, res: Response): Promise<void> {
        const tenantId = (req as any).tenantId as string;
        if (!tenantId) throw new AppError('Não autenticado', 401);

        const { groupId } = req.params;

        const result = await this.dbPool.query(`
            SELECT 
                tgm.id AS group_member_id,
                p.id AS patient_id,
                p.name AS patient_name,
                (tg.duration_months * tg.monthly_fee_cents) AS default_upfront_price_cents
            FROM therapy_group_members tgm
            JOIN psychotherapy_patients p ON p.id = tgm.patient_id
            JOIN therapy_groups tg ON tg.id = tgm.group_id
            WHERE tgm.group_id = $1
              AND tgm.tenant_id = $2
              AND tgm.left_at IS NULL
              AND NOT EXISTS (
                  SELECT 1 FROM therapy_group_member_billing_policies bp
                  WHERE bp.member_id = tgm.id
                    AND bp.billing_type = 'upfront'
                    AND bp.status = 'active'
              )
        `, [groupId, tenantId]);

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
                tgm.id          AS group_member_id,
                p.id            AS patient_id,
                p.name,
                p.phone,
                COALESCE(bp.billing_type, 'monthly') AS payment_type,
                p.default_session_price_cents,
                p.status        AS patient_status,
                tgm.joined_at,
                tgm.left_at,
                -- Indicadores de presença calculados direto de group_session_records
                COALESCE(sess.present_count, 0)  AS paid_sessions,
                COALESCE(sess.total_count,   0)  AS expected_sessions,
                COALESCE(sess.absent_count,  0)  AS absences,
                -- Status de pagamento vem de group_payments (mensalidade flat)
                COALESCE(gp_status.payment_status, 'pending') AS payment_status
            FROM therapy_group_members tgm
            JOIN psychotherapy_patients p ON p.id = tgm.patient_id
            -- Política vigente NO MÊS CONSULTADO (não CURRENT_DATE) e do tenant certo — evita
            -- pegar uma política histórica que ainda está status='active' com valid_until no
            -- passado (ConfirmGroupPaymentUseCase só fecha valid_until, nunca muda status ao
            -- ativar uma nova política upfront).
            LEFT JOIN LATERAL (
                SELECT billing_type
                FROM therapy_group_member_billing_policies bp
                WHERE bp.member_id = tgm.id
                  AND bp.tenant_id = $2
                  AND bp.status = 'active'
                  AND bp.valid_from <= (to_date($3, 'YYYY-MM') + INTERVAL '1 month' - INTERVAL '1 day')
                  AND (bp.valid_until IS NULL OR bp.valid_until >= to_date($3, 'YYYY-MM'))
                ORDER BY bp.valid_from DESC
                LIMIT 1
            ) bp ON true
            -- Presença: contagem de sessões do mês para este membro neste grupo
            LEFT JOIN LATERAL (
                SELECT
                    COUNT(*) FILTER (WHERE gsr.attendance_status = 'present') AS present_count,
                    COUNT(*) FILTER (WHERE gsr.attendance_status = 'absent')  AS absent_count,
                    COUNT(*)                                                   AS total_count
                FROM group_session_records gsr
                WHERE gsr.group_id   = tgm.group_id
                  AND gsr.patient_id = tgm.patient_id
                  AND gsr.tenant_id  = $2
                  AND TO_CHAR(gsr.session_date, 'YYYY-MM') = $3
            ) sess ON true
            -- Status de pagamento: vem dos pagamentos de grupo do mês ou pacotes
            LEFT JOIN LATERAL (
                SELECT
                    CASE
                        WHEN tg.monthly_fee_cents IS NULL OR tg.monthly_fee_cents = 0 THEN 'paid'
                        -- Pacote pago cobre o mês consultado se a compra ocorreu ATÉ esse mês
                        -- (não em todo mês indiscriminadamente — meses anteriores à compra
                        -- podem ter dívida real não quitada, que o pacote não cobre).
                        WHEN EXISTS (
                            SELECT 1 FROM group_payments gp2
                            WHERE gp2.group_member_id = tgm.id AND gp2.tenant_id = $2 AND gp2.status = 'paid'
                              AND gp2.charge_type = 'course_upfront'
                              AND TO_CHAR(gp2.paid_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') <= $3
                        ) THEN 'paid'
                        WHEN COALESCE(SUM(gp.amount_cents) FILTER (WHERE gp.status = 'paid' AND gp.charge_type = 'monthly'), 0) = 0 AND NOT EXISTS (SELECT 1 FROM group_payments gp3 WHERE gp3.group_member_id = tgm.id AND gp3.tenant_id = $2 AND gp3.charge_type = 'course_upfront') THEN 'pending'
                        WHEN COALESCE(SUM(gp.amount_cents) FILTER (WHERE gp.status = 'paid' AND gp.charge_type = 'monthly'), 0) >= tg.monthly_fee_cents THEN 'paid'
                        ELSE 'partial'
                    END AS payment_status
                FROM therapy_groups tg
                LEFT JOIN group_payments gp
                    ON  gp.group_member_id = tgm.id
                    AND (gp.reference_month = $3 OR gp.charge_type = 'course_upfront')
                    AND gp.tenant_id       = $2
                WHERE tg.id = tgm.group_id
                GROUP BY tg.monthly_fee_cents, tgm.id
            ) gp_status ON true
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

    /** GET /psychotherapy/patients/:patientId/groups */
    async listPatientGroups(req: Request, res: Response): Promise<void> {
        const tenantId = (req as any).tenantId as string;
        if (!tenantId) throw new AppError('Não autenticado', 401);

        const { patientId } = req.params;

        // Verifica se o paciente pertence ao tenant
        const patientCheck = await this.dbPool.query('SELECT id FROM psychotherapy_patients WHERE id = $1 AND tenant_id = $2', [patientId, tenantId]);
        if (patientCheck.rows.length === 0) {
            throw new AppError('Paciente não encontrado', 404);
        }

        try {
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
                    tg.monthly_fee_cents,
                    tg.start_date,
                    tg.duration_months,
                    tgm.joined_at
                FROM therapy_groups tg
                JOIN therapy_group_members tgm ON tgm.group_id = tg.id
                WHERE tgm.patient_id = $1
                  AND tg.tenant_id = $2
                  AND tgm.left_at IS NULL
                  AND tg.deleted_at IS NULL
                ORDER BY tg.name ASC;
            `, [patientId, tenantId]);

            res.status(200).json({
                success: true,
                data: result.rows,
            });
        } catch (error: any) {
            logger.error({ tenantId, patientId, err: error.message }, 'Erro ao listar grupos do paciente');
            throw new AppError('Erro ao listar grupos do paciente', 500);
        }
    }

    /** POST /psychotherapy/groups/:groupId/members-new */
    async addGroupMemberIdempotent(req: Request, res: Response): Promise<void> {
        const tenantId = (req as any).tenantId as string;
        if (!tenantId) throw new AppError('Não autenticado', 401);

        const { groupId } = req.params;
        const { requestId, name, phone, document, email } = req.body;

        const result = await this.addGroupMemberIdempotentUseCase.execute({
            tenantId,
            groupId,
            requestId,
            name,
            phone,
            document,
            email,
        });

        res.status(201).json({ success: true, data: result });
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
                tgm.id          AS group_member_id,
                p.name,
                COALESCE(bp.billing_type, 'monthly') AS payment_type,
                COALESCE(SUM(gp.amount_paid_cents) FILTER (WHERE gp.status = 'paid'), 0)::int AS total_paid_cents,
                COALESCE(SUM(gp.net_amount_cents) FILTER (WHERE gp.status = 'paid'), 0)::int AS total_net_cents,
                COALESCE(SUM(gp.processing_fee_cents) FILTER (WHERE gp.status = 'paid'), 0)::int AS total_fee_cents,
                COUNT(gp.id) FILTER (WHERE gp.status != 'voided')::int                   AS payments_count,
                MAX(gp.total_installments)                                               AS total_installments,
                tg.monthly_fee_cents,
                CASE
                    WHEN tg.monthly_fee_cents IS NULL OR tg.monthly_fee_cents = 0 THEN 'paid'
                    -- Pacote pago cobre o mês consultado se a compra ocorreu ATÉ esse mês (não
                    -- em todo mês — evita duplicar a mesma cobrança em toda competência vista).
                    WHEN EXISTS (
                        SELECT 1 FROM group_payments gp2
                        WHERE gp2.group_member_id = tgm.id AND gp2.tenant_id = $2 AND gp2.status = 'paid'
                          AND gp2.charge_type = 'course_upfront'
                          AND TO_CHAR(gp2.paid_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') <= $1
                    ) THEN 'paid'
                    WHEN COALESCE(SUM(gp.amount_paid_cents) FILTER (WHERE gp.status = 'paid'), 0) = 0 THEN 'pending'
                    WHEN COALESCE(SUM(gp.amount_paid_cents) FILTER (WHERE gp.status = 'paid'), 0) >= tg.monthly_fee_cents THEN 'paid'
                    ELSE 'partial'
                END AS payment_status,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'id', gp.id,
                            'amount_cents', gp.amount_cents,
                            'amount_paid_cents', gp.amount_paid_cents,
                            'net_amount_cents', gp.net_amount_cents,
                            'processing_fee_cents', gp.processing_fee_cents,
                            'payment_method', gp.payment_method,
                            'total_installments', gp.total_installments,
                            'installment_number', gp.installment_number,
                            'installment_group_id', gp.installment_group_id,
                            'paid_at', gp.paid_at,
                            'notes', gp.notes,
                            'status', gp.status,
                            'due_date', gp.due_date
                        ) ORDER BY gp.due_date ASC
                    ) FILTER (WHERE gp.id IS NOT NULL AND gp.status != 'voided'),
                    '[]'::json
                ) AS payments
            FROM therapy_group_members tgm
            JOIN psychotherapy_patients p  ON p.id  = tgm.patient_id
            JOIN therapy_groups tg         ON tg.id = tgm.group_id
            -- Política vigente NO MÊS CONSULTADO (mesmo padrão de listGroupMembers).
            LEFT JOIN LATERAL (
                SELECT billing_type
                FROM therapy_group_member_billing_policies bp
                WHERE bp.member_id = tgm.id
                  AND bp.tenant_id = $2
                  AND bp.status = 'active'
                  AND bp.valid_from <= (to_date($1, 'YYYY-MM') + INTERVAL '1 month' - INTERVAL '1 day')
                  AND (bp.valid_until IS NULL OR bp.valid_until >= to_date($1, 'YYYY-MM'))
                ORDER BY bp.valid_from DESC
                LIMIT 1
            ) bp ON true
            -- Pagamento de pacote (course_upfront) só entra nos totais/lista do MÊS EM QUE
            -- FOI PAGO (paid_at) — não em todo mês, senão o mesmo valor apareceria somado em
            -- cada competência vista.
            LEFT JOIN group_payments gp
                ON  gp.group_member_id = tgm.id
                AND (
                    gp.reference_month = $1
                    OR (gp.charge_type = 'course_upfront' AND TO_CHAR(gp.paid_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') = $1)
                )
                AND gp.tenant_id       = $2
                AND gp.status != 'voided'
            WHERE tgm.group_id   = $3
              AND tgm.left_at   IS NULL
              AND p.tenant_id    = $2
            GROUP BY p.id, p.name, bp.billing_type, tg.monthly_fee_cents, tgm.id
            ORDER BY p.name ASC;
        `, [effectiveMonth, tenantId, groupId]);

        res.status(200).json({
            success: true,
            data: result.rows,
            meta: { month: effectiveMonth }
        });
    }

}

function addMonths(monthStr: string, monthsToAdd: number): string {
    const [year, month] = monthStr.split('-').map(Number);
    const date = new Date(year, month - 1 + monthsToAdd, 1);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}
