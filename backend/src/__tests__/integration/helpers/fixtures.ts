/**
 * fixtures.ts — Factories para criação de dados de teste no banco de integração.
 *
 * Todas as funções recebem um Pool pg e inserem diretamente via SQL,
 * retornando o ID gerado. Cada fábrica aceita overrides opcionais.
 */

import { Pool } from 'pg';
import { randomUUID as uuidv4 } from 'node:crypto';

// ── Tenant ────────────────────────────────────────────────────────────────────

export interface TenantFixture {
    id: string;
    email: string;
    name: string;
}

export async function createTenant(pool: Pool, overrides: Partial<TenantFixture> = {}): Promise<TenantFixture> {
    const id    = overrides.id    ?? uuidv4();
    const email = overrides.email ?? `tenant_${id.slice(0, 8)}@test.com`;
    const name  = overrides.name  ?? `Tenant ${id.slice(0, 8)}`;

    await pool.query(`
        INSERT INTO tenants (id, email, name, password_hash, plan, status, created_at)
        VALUES ($1, $2, $3, 'hash', 'pro', 'active', NOW())
    `, [id, email, name]);

    return { id, email, name };
}

// ── Patient ───────────────────────────────────────────────────────────────────

export interface PatientFixture {
    id: string;
    tenantId: string;
    name: string;
}

export async function createPatient(
    pool: Pool,
    tenantId: string,
    overrides: Partial<{ name: string; document: string; individualTherapyEnabled: boolean; status: string }> = {}
): Promise<PatientFixture> {
    const id   = uuidv4();
    const name = overrides.name ?? `Paciente ${id.slice(0, 8)}`;
    // 'active' não é um valor válido de status desde a migration 086 (o campo representa
    // cadência de sessão: weekly/biweekly/monthly/one_off/inactive, não estado de vínculo) —
    // achado ao rodar a suíte de integração contra um schema totalmente migrado pela primeira
    // vez nesta sessão (psychotherapy_patients_status_check rejeitava toda inserção default).
    const status = overrides.status ?? 'weekly';

    await pool.query(`
        INSERT INTO psychotherapy_patients (
            id, tenant_id, name, full_name, status,
            payment_type, default_session_price_cents,
            individual_therapy_enabled
        ) VALUES (
            $1, $2, $3, $3, $4,
            'per_session', 15000,
            $5
        )
    `, [id, tenantId, name, status, overrides.individualTherapyEnabled ?? false]);

    return { id, tenantId, name };
}

// ── Therapy Group ─────────────────────────────────────────────────────────────

export interface GroupFixture {
    id: string;
    tenantId: string;
    name: string;
    monthlyFeeCents: number;
    sessionPriceCents: number;
}

export async function createGroup(
    pool: Pool,
    tenantId: string,
    overrides: Partial<{ name: string; monthlyFeeCents: number; sessionPriceCents: number; durationMonths: number }> = {}
): Promise<GroupFixture> {
    const id               = uuidv4();
    const name             = overrides.name             ?? `Grupo ${id.slice(0, 8)}`;
    const monthlyFeeCents  = overrides.monthlyFeeCents  ?? 20000;
    const sessionPriceCents = overrides.sessionPriceCents ?? 0;
    const durationMonths   = overrides.durationMonths   ?? null;

    await pool.query(`
        INSERT INTO therapy_groups (
            id, tenant_id, name, is_active,
            monthly_fee_cents, session_price_cents,
            duration_minutes, start_time, duration_months
        ) VALUES (
            $1, $2, $3, true,
            $4, $5,
            90, '10:00', $6
        )
    `, [id, tenantId, name, monthlyFeeCents, sessionPriceCents, durationMonths]);

    return { id, tenantId, name, monthlyFeeCents, sessionPriceCents };
}

// ── Group Member ──────────────────────────────────────────────────────────────

export async function addGroupMember(
    pool: Pool,
    groupId: string,
    patientId: string,
    tenantId: string
): Promise<string> {
    const res = await pool.query(`
        INSERT INTO therapy_group_members (group_id, patient_id, tenant_id, joined_at)
        VALUES ($1, $2, $3, NOW())
        RETURNING id
    `, [groupId, patientId, tenantId]);
    const memberId = res.rows[0].id;

    // Mesmo padrão usado por AttachExistingGroupMemberUseCase.ts em produção: todo
    // membro precisa de uma política de faturamento ativa pra RegisterGroupSessionUseCase aceitar sessões.
    await pool.query(`
        INSERT INTO therapy_group_member_billing_policies (
            id, tenant_id, group_id, patient_id, member_id,
            billing_type, valid_from, approved_by, status
        ) VALUES (
            gen_random_uuid(), $1, $2, $3, $4,
            'group_default', '2000-01-01'::date, $3, 'active'
        )
    `, [tenantId, groupId, patientId, memberId]);

    return memberId;
}

// ── Monthly Record ────────────────────────────────────────────────────────────

export interface MonthlyRecordFixture {
    id: string;
    tenantId: string;
    patientId: string;
    month: string;
}

export async function createMonthlyRecord(
    pool: Pool,
    tenantId: string,
    patientId: string,
    overrides: Partial<{ month: string; patientName: string; status: string; paymentType: string }> = {}
): Promise<MonthlyRecordFixture> {
    const id          = uuidv4();
    const month       = overrides.month ?? '2025-01';
    const patientName = overrides.patientName ?? `Paciente ${id.slice(0, 8)}`;
    const status       = overrides.status ?? 'weekly';
    const paymentType = overrides.paymentType ?? 'per_session';

    await pool.query(`
        INSERT INTO psychotherapy_monthly_records (
            id, tenant_id, patient_id, month, patient_name_snapshot, status, payment_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [id, tenantId, patientId, month, patientName, status, paymentType]);

    return { id, tenantId, patientId, month };
}

// ── Group Payment (pending) ───────────────────────────────────────────────────

export interface GroupPaymentFixture {
    id: string;
    tenantId: string;
    groupId: string;
    patientId: string;
    amountCents: number;
    referenceMonth: string;
    status: 'pending' | 'paid' | 'voided';
}

export async function createGroupPayment(
    pool: Pool,
    opts: {
        tenantId: string;
        groupId: string;
        patientId: string;
        groupMemberId?: string;
        amountCents?: number;
        /** Valor efetivamente pago — obrigatório pela constraint chk_gp_paid_amount quando
         *  status='paid'. Default: igual a amountCents (sem desconto) se status='paid'. */
        amountPaidCents?: number;
        referenceMonth?: string;
        status?: 'pending' | 'paid' | 'voided';
        chargeType?: 'monthly' | 'course_upfront' | 'installments';
        /** Sobrescreve due_date (default: primeiro dia de referenceMonth). Use pra testar
         *  cenários de "vencido" (passado) vs "coberto" (futuro) em relação a CURRENT_DATE. */
        dueDate?: string;
    }
): Promise<GroupPaymentFixture> {
    const id             = uuidv4();
    const amountCents    = opts.amountCents    ?? 20000;
    const referenceMonth = opts.referenceMonth ?? '2025-01';
    const status         = opts.status         ?? 'pending';
    const chargeType     = opts.chargeType     ?? 'monthly';
    const dueDate        = opts.dueDate        ?? `${referenceMonth}-01`;
    const amountPaidCents = opts.amountPaidCents ?? (status === 'paid' ? amountCents : null);

    await pool.query(`
        INSERT INTO group_payments (
            id, tenant_id, group_id, patient_id, group_member_id, charge_type,
            reference_month, amount_cents, original_amount_cents, amount_paid_cents,
            status, due_date
        ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $8, $9,
            $10, $11::date
        )
    `, [id, opts.tenantId, opts.groupId, opts.patientId, opts.groupMemberId || null, chargeType,
        `${referenceMonth}-01`, amountCents, amountPaidCents, status, dueDate]);

    return {
        id, tenantId: opts.tenantId, groupId: opts.groupId,
        patientId: opts.patientId, amountCents, referenceMonth, status,
    };
}
