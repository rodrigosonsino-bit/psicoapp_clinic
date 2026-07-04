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
    overrides: Partial<{ name: string; document: string; individualTherapyEnabled: boolean }> = {}
): Promise<PatientFixture> {
    const id   = uuidv4();
    const name = overrides.name ?? `Paciente ${id.slice(0, 8)}`;

    await pool.query(`
        INSERT INTO psychotherapy_patients (
            id, tenant_id, name, full_name, status,
            payment_type, default_session_price_cents,
            individual_therapy_enabled
        ) VALUES (
            $1, $2, $3, $3, 'active',
            'per_session', 15000,
            $4
        )
    `, [id, tenantId, name, overrides.individualTherapyEnabled ?? false]);

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
        ON CONFLICT (group_id, patient_id) DO UPDATE SET joined_at = NOW()
        RETURNING id
    `, [groupId, patientId, tenantId]);
    return res.rows[0].id;
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
