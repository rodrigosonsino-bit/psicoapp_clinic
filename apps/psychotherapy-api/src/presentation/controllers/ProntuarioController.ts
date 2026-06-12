import { Request, Response } from 'express';
import { injectable, inject } from 'tsyringe';
import { Pool } from 'pg';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { AppError } from '../../domain/errors/AppError';

@injectable()
export class ProntuarioController {
    constructor(@inject(Pool) private readonly dbPool: Pool) {}

    // ── Anamnese ──────────────────────────────────────────────────────────────

    /**
     * GET /patients/:patientId/anamnesis
     * Retorna a anamnese existente ou um objeto vazio padrão (nunca 404).
     * Garante que o frontend sempre tem um payload para exibir.
     */
    async getAnamnesis(req: Request, res: Response): Promise<void> {
        const tenantId = this.getTenantId(req);
        const { patientId } = req.params;

        await this.assertPatientBelongsToTenant(patientId, tenantId);

        const result = await this.dbPool.query(
            `SELECT id, chief_complaint, onset_description, previous_treatment,
                    medications, family_history, relevant_history,
                    cid_codes, therapeutic_approach, created_at, updated_at
             FROM psychotherapy_anamnesis
             WHERE tenant_id = $1 AND patient_id = $2`,
            [tenantId, patientId],
        );

        if (result.rows.length === 0) {
            // Retorna estrutura vazia — o front faz upsert na primeira edição
            res.json({
                id: null,
                chiefComplaint: null,
                onsetDescription: null,
                previousTreatment: null,
                medications: null,
                familyHistory: null,
                relevantHistory: null,
                cidCodes: [],
                therapeuticApproach: null,
                createdAt: null,
                updatedAt: null,
            });
            return;
        }

        const r = result.rows[0];
        res.json(this.mapAnamnesis(r));
    }

    /**
     * PUT /patients/:patientId/anamnesis
     * Upsert idempotente — cria ou atualiza a anamnese.
     */
    async upsertAnamnesis(req: Request, res: Response): Promise<void> {
        const tenantId = this.getTenantId(req);
        const { patientId } = req.params;
        const {
            chiefComplaint, onsetDescription, previousTreatment,
            medications, familyHistory, relevantHistory,
            cidCodes, therapeuticApproach,
        } = req.body as {
            chiefComplaint?: string | null;
            onsetDescription?: string | null;
            previousTreatment?: string | null;
            medications?: string | null;
            familyHistory?: string | null;
            relevantHistory?: string | null;
            cidCodes?: string[];
            therapeuticApproach?: string | null;
        };

        await this.assertPatientBelongsToTenant(patientId, tenantId);

        const result = await this.dbPool.query(
            `INSERT INTO psychotherapy_anamnesis
                 (tenant_id, patient_id, chief_complaint, onset_description,
                  previous_treatment, medications, family_history, relevant_history,
                  cid_codes, therapeutic_approach)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (tenant_id, patient_id) DO UPDATE SET
                 chief_complaint      = EXCLUDED.chief_complaint,
                 onset_description    = EXCLUDED.onset_description,
                 previous_treatment   = EXCLUDED.previous_treatment,
                 medications          = EXCLUDED.medications,
                 family_history       = EXCLUDED.family_history,
                 relevant_history     = EXCLUDED.relevant_history,
                 cid_codes            = EXCLUDED.cid_codes,
                 therapeutic_approach = EXCLUDED.therapeutic_approach,
                 updated_at           = NOW()
             RETURNING *`,
            [
                tenantId, patientId,
                chiefComplaint ?? null, onsetDescription ?? null,
                previousTreatment ?? null, medications ?? null,
                familyHistory ?? null, relevantHistory ?? null,
                cidCodes ?? [], therapeuticApproach ?? null,
            ],
        );

        res.json(this.mapAnamnesis(result.rows[0]));
    }

    // ── Planos Terapêuticos ───────────────────────────────────────────────────

    /**
     * GET /patients/:patientId/treatment-plans
     * Lista todos os planos (mais recente primeiro).
     */
    async listTreatmentPlans(req: Request, res: Response): Promise<void> {
        const tenantId = this.getTenantId(req);
        const { patientId } = req.params;

        await this.assertPatientBelongsToTenant(patientId, tenantId);

        const result = await this.dbPool.query(
            `SELECT id, title, goals, approach, target_sessions, status,
                    started_at, ended_at, notes, created_at, updated_at
             FROM psychotherapy_treatment_plans
             WHERE tenant_id = $1 AND patient_id = $2
             ORDER BY created_at DESC`,
            [tenantId, patientId],
        );

        res.json({ data: result.rows.map(r => this.mapPlan(r)) });
    }

    /**
     * POST /patients/:patientId/treatment-plans
     * Cria um novo plano terapêutico.
     */
    async createTreatmentPlan(req: Request, res: Response): Promise<void> {
        const tenantId = this.getTenantId(req);
        const { patientId } = req.params;
        const { title, goals, approach, targetSessions, notes } = req.body as {
            title: string;
            goals?: string[];
            approach?: string | null;
            targetSessions?: number | null;
            notes?: string | null;
        };

        await this.assertPatientBelongsToTenant(patientId, tenantId);

        const result = await this.dbPool.query(
            `INSERT INTO psychotherapy_treatment_plans
                 (tenant_id, patient_id, title, goals, approach, target_sessions, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [tenantId, patientId, title, goals ?? [], approach ?? null, targetSessions ?? null, notes ?? null],
        );

        res.status(201).json(this.mapPlan(result.rows[0]));
    }

    /**
     * PATCH /patients/:patientId/treatment-plans/:planId/status
     * Encerra (completed) ou suspende (suspended) um plano.
     */
    async updateTreatmentPlanStatus(req: Request, res: Response): Promise<void> {
        const tenantId = this.getTenantId(req);
        const { patientId, planId } = req.params;
        const { status } = req.body as { status: 'completed' | 'suspended' | 'active' };

        await this.assertPatientBelongsToTenant(patientId, tenantId);

        const endedAt = status === 'active' ? null : 'CURRENT_DATE';

        const result = await this.dbPool.query(
            `UPDATE psychotherapy_treatment_plans
             SET status    = $1,
                 ended_at  = ${endedAt ? 'CURRENT_DATE' : 'NULL'},
                 updated_at = NOW()
             WHERE id = $2 AND tenant_id = $3 AND patient_id = $4
             RETURNING *`,
            [status, planId, tenantId, patientId],
        );

        if (result.rows.length === 0) throw new AppError('Plano não encontrado', 404);

        res.json(this.mapPlan(result.rows[0]));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private getTenantId(req: Request): string {
        const tenantId = (req as AuthenticatedRequest).tenantId || (req as AuthenticatedRequest).userId;
        if (!tenantId) throw new AppError('Tenant não identificado', 401);
        return tenantId;
    }

    private async assertPatientBelongsToTenant(patientId: string, tenantId: string): Promise<void> {
        const check = await this.dbPool.query(
            'SELECT id FROM psychotherapy_patients WHERE id = $1 AND tenant_id = $2',
            [patientId, tenantId],
        );
        if (check.rows.length === 0) throw new AppError('Paciente não encontrado', 404);
    }

    private mapAnamnesis(r: Record<string, unknown>) {
        return {
            id:                  r.id,
            chiefComplaint:      r.chief_complaint,
            onsetDescription:    r.onset_description,
            previousTreatment:   r.previous_treatment,
            medications:         r.medications,
            familyHistory:       r.family_history,
            relevantHistory:     r.relevant_history,
            cidCodes:            r.cid_codes,
            therapeuticApproach: r.therapeutic_approach,
            createdAt:           r.created_at,
            updatedAt:           r.updated_at,
        };
    }

    private mapPlan(r: Record<string, unknown>) {
        return {
            id:             r.id,
            title:          r.title,
            goals:          r.goals,
            approach:       r.approach,
            targetSessions: r.target_sessions,
            status:         r.status,
            startedAt:      r.started_at,
            endedAt:        r.ended_at,
            notes:          r.notes,
            createdAt:      r.created_at,
            updatedAt:      r.updated_at,
        };
    }
}
