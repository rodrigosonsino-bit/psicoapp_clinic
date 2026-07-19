/**
 * dashboardAnalytics.integration.test.ts
 *
 * Testes de integração contra Postgres real para
 * PostgresBillingRepository.getDashboardAnalytics — o único método COMPLEXO do
 * repositório de billing ainda sem cobertura (cutover ledger/legado, snapshot legado,
 * fallback de fórmula antiga, tendência de 6 meses e cálculo de pendências).
 *
 * Cenários cobertos:
 * 1. Pós-cutover: revenue soma o ledger confirmado; sessionRevenue exclui pagamentos
 *    sem monthly_record_id (cobranças de grupo).
 * 2. Pré-cutover com snapshot legado aprovado: usa o snapshot, ignora a fórmula antiga.
 * 3. Pré-cutover sem snapshot: fórmula antiga (session_price*paid_sessions+previous_month_paid)
 *    + soma de group_payments do mês.
 * 4. sixMonthsTrend: 6 meses cronológicos, cruzando a fronteira do cutover.
 * 5. Efeito colateral de instanciação automática de despesas fixas nas expensesCents.
 * 6. Pendências pós-cutover: mês vencido conta (regra do dia 11), mês corrente nunca conta.
 * 7. Pendências pré-cutover: fórmulas 'monthly' e 'per_session' (else) do legado.
 * 8. Isolamento por tenant.
 */

import 'reflect-metadata';
import { Pool } from 'pg';
import { getTestPool, teardownTestDb, truncateTables } from './helpers/testDb';
import { createTenant, createPatient, createMonthlyRecord, createGroup, addGroupMember } from './helpers/fixtures';
import { PostgresBillingRepository } from '../../infrastructure/repositories/PostgresBillingRepository';
import { PostgresExpenseRepository } from '../../infrastructure/repositories/PostgresExpenseRepository';
import { RegisterPaymentDTO } from '../../domain/repositories/IPsychotherapyRepository';

jest.setTimeout(120_000);

const TABLES = [
    'financial_payments', 'legacy_financial_snapshots', 'tenant_financial_cutovers',
    'group_payments', 'therapy_group_member_billing_policies', 'therapy_group_members', 'therapy_groups',
    'psychotherapy_expenses', 'psychotherapy_fixed_expenses',
    'psychotherapy_monthly_records', 'psychotherapy_patients', 'tenants',
];

let pool: Pool;
let billingRepo: PostgresBillingRepository;

beforeAll(async () => {
    pool = await getTestPool();
    billingRepo = new PostgresBillingRepository(pool, new PostgresExpenseRepository(pool));
});

afterAll(async () => {
    await teardownTestDb();
});

afterEach(async () => {
    await truncateTables(pool, TABLES);
});

async function approveCutover(tenantId: string, cutoverAt: string): Promise<void> {
    await pool.query(`
        INSERT INTO tenant_financial_cutovers (tenant_id, cutover_at, status, approved_at, approved_by)
        VALUES ($1, $2::timestamptz, 'approved', NOW(), $1)
    `, [tenantId, cutoverAt]);
}

function basePaymentDto(overrides: Partial<RegisterPaymentDTO> = {}): RegisterPaymentDTO {
    return {
        tenantId: overrides.tenantId!,
        patientId: overrides.patientId!,
        monthlyRecordId: overrides.monthlyRecordId,
        amountCents: overrides.amountCents ?? 15000,
        paidAt: overrides.paidAt ?? new Date(),
        method: overrides.method ?? 'pix',
        source: overrides.source ?? 'manual',
        idempotencyKey: overrides.idempotencyKey ?? `idem-${Math.random().toString(36).slice(2)}`,
        createdBy: overrides.createdBy!,
        netAmountCents: overrides.netAmountCents,
        processingFeeCents: overrides.processingFeeCents,
    };
}

describe('PostgresBillingRepository.getDashboardAnalytics — pós-cutover (ledger)', () => {
    it('#1 — revenue soma o ledger confirmado; sessionRevenue exclui pagamentos sem monthly_record_id', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const record = await createMonthlyRecord(pool, tenant.id, patient.id, { month: '2025-06' });
        await approveCutover(tenant.id, '2025-01-01T00:00:00Z');

        // Pagamento individual (sessão), vinculado a monthly_record_id — conta em ambos.
        await billingRepo.registerPayment(basePaymentDto({
            tenantId: tenant.id, patientId: patient.id, createdBy: tenant.id,
            monthlyRecordId: record.id, amountCents: 15000,
            paidAt: new Date('2025-06-10T12:00:00Z'),
        }));

        // Pagamento sem monthly_record_id (equivalente a uma cobrança de grupo no ledger) —
        // conta em revenue, mas é excluído de sessionRevenue.
        await billingRepo.registerPayment(basePaymentDto({
            tenantId: tenant.id, patientId: patient.id, createdBy: tenant.id,
            monthlyRecordId: undefined, amountCents: 20000,
            paidAt: new Date('2025-06-15T12:00:00Z'),
        }));

        const result = await billingRepo.getDashboardAnalytics(tenant.id, '2025-06');

        expect(result.currentMonth.revenueCents).toBe(35000);
        expect(result.currentMonth.sessionRevenueCents).toBe(15000);
        expect(result.currentMonth.netIncomeCents).toBe(35000 - result.currentMonth.expensesCents);
    });

    it('#2 — pagamentos estornados (voided) não contam na receita', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        await approveCutover(tenant.id, '2025-01-01T00:00:00Z');

        const payment = await billingRepo.registerPayment(basePaymentDto({
            tenantId: tenant.id, patientId: patient.id, createdBy: tenant.id,
            amountCents: 15000, paidAt: new Date('2025-06-10T12:00:00Z'),
        }));
        await billingRepo.voidPayment(tenant.id, payment.id, tenant.id, 'Teste de estorno');

        const result = await billingRepo.getDashboardAnalytics(tenant.id, '2025-06');
        expect(result.currentMonth.revenueCents).toBe(0);
    });
});

describe('PostgresBillingRepository.getDashboardAnalytics — pré-cutover (legado)', () => {
    it('#3 — usa snapshot legado aprovado quando presente, ignorando a fórmula antiga', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        // Registro mensal com dados que dariam um resultado BEM diferente na fórmula antiga —
        // prova que o snapshot tem prioridade.
        await createMonthlyRecord(pool, tenant.id, patient.id, {
            month: '2025-03', sessionPriceCents: 99999, paidSessions: 99,
        });

        await pool.query(`
            INSERT INTO legacy_financial_snapshots (
                tenant_id, patient_id, month, amount_cents, paid_sessions,
                source_formula_version, status, approved_at, approved_by
            ) VALUES ($1, $2, '2025-03', 45000, 3, 'v1', 'approved', NOW(), $1)
        `, [tenant.id, patient.id]);

        const result = await billingRepo.getDashboardAnalytics(tenant.id, '2025-03');
        expect(result.currentMonth.revenueCents).toBe(45000);
        expect(result.currentMonth.sessionRevenueCents).toBe(45000);
    });

    it('#4 — sem snapshot, cai na fórmula antiga (session_price*paid_sessions+previous_month_paid) + group_payments', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        await createMonthlyRecord(pool, tenant.id, patient.id, {
            month: '2025-04', sessionPriceCents: 10000, paidSessions: 3, previousMonthPaidCents: 5000,
        });
        // session_price*paid_sessions + previous_month_paid = 10000*3 + 5000 = 35000

        const group = await createGroup(pool, tenant.id);
        const memberId = await addGroupMember(pool, group.id, patient.id, tenant.id, '2025-01-01');
        await pool.query(`
            INSERT INTO group_payments (
                id, tenant_id, group_id, patient_id, group_member_id, charge_type,
                reference_month, amount_cents, original_amount_cents, status, due_date
            ) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'monthly', '2025-04', 8000, 8000, 'pending', '2025-04-10')
        `, [tenant.id, group.id, patient.id, memberId]);

        const result = await billingRepo.getDashboardAnalytics(tenant.id, '2025-04');
        expect(result.currentMonth.sessionRevenueCents).toBe(35000);
        expect(result.currentMonth.revenueCents).toBe(35000 + 8000);
    });
});

describe('PostgresBillingRepository.getDashboardAnalytics — sixMonthsTrend', () => {
    it('#5 — retorna 6 meses em ordem cronológica, cruzando a fronteira do cutover', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        // Cutover no meio da janela de 6 meses: 2025-02 a 2025-07, cutover em 2025-05.
        await approveCutover(tenant.id, '2025-05-01T00:00:00Z');

        // Mês pré-cutover (fórmula antiga)
        await createMonthlyRecord(pool, tenant.id, patient.id, {
            month: '2025-03', sessionPriceCents: 10000, paidSessions: 1,
        });
        // Mês pós-cutover (ledger)
        await billingRepo.registerPayment(basePaymentDto({
            tenantId: tenant.id, patientId: patient.id, createdBy: tenant.id,
            amountCents: 25000, paidAt: new Date('2025-06-05T12:00:00Z'),
        }));

        const result = await billingRepo.getDashboardAnalytics(tenant.id, '2025-07');
        expect(result.sixMonthsTrend.map(m => m.month)).toEqual([
            '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07',
        ]);

        const marRow = result.sixMonthsTrend.find(m => m.month === '2025-03')!;
        const junRow = result.sixMonthsTrend.find(m => m.month === '2025-06')!;
        expect(marRow.revenueCents).toBe(10000);
        expect(junRow.revenueCents).toBe(25000);
    });

    it('#6 — despesa fixa é auto-instanciada e entra em expensesCents do mês', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        await createMonthlyRecord(pool, tenant.id, patient.id, { month: '2025-07' });

        await pool.query(`
            INSERT INTO psychotherapy_fixed_expenses (
                id, tenant_id, description, amount_cents, day_of_month, start_date, active
            ) VALUES (gen_random_uuid(), $1, 'Aluguel', 150000, 5, '2020-01-01', true)
        `, [tenant.id]);

        const result = await billingRepo.getDashboardAnalytics(tenant.id, '2025-07');
        const julRow = result.sixMonthsTrend.find(m => m.month === '2025-07')!;
        expect(julRow.expensesCents).toBe(150000);
        expect(result.currentMonth.expensesCents).toBe(150000);

        // Confirma que a despesa foi realmente persistida (efeito colateral), não só somada em memória.
        const rows = await pool.query(
            `SELECT id FROM psychotherapy_expenses WHERE tenant_id = $1 AND reference_month = '2025-07'`,
            [tenant.id]
        );
        expect(rows.rows).toHaveLength(1);
    });
});

describe('PostgresBillingRepository.getDashboardAnalytics — pendências', () => {
    it('#7 — pós-cutover: mês vencido (regra do dia 11) conta como pendente; mês corrente nunca conta', async () => {
        const tenant = await createTenant(pool);
        // payment_type='monthly': registerPayment aciona syncMonthlyRecord, que recalcula
        // expected_amount_cents a partir do paciente — pra 'monthly' isso é sempre
        // default_session_price_cents, independente de agendamentos reais (sobrescreveria um
        // valor setado manualmente na fixture do registro mensal).
        const patient = await createPatient(pool, tenant.id, { paymentType: 'monthly', defaultSessionPriceCents: 30000 });
        await approveCutover(tenant.id, '2020-01-01T00:00:00Z');

        // Mês bem no passado — com certeza já venceu (dia 11 do mês seguinte já passou).
        const overdue = await createMonthlyRecord(pool, tenant.id, patient.id, {
            month: '2025-01', paymentType: 'monthly', expectedAmountCents: 30000,
        });
        await billingRepo.registerPayment(basePaymentDto({
            tenantId: tenant.id, patientId: patient.id, createdBy: tenant.id,
            monthlyRecordId: overdue.id, amountCents: 10000,
            paidAt: new Date('2025-01-15T12:00:00Z'),
        }));
        // Pendente esperado: 30000 (recalculado por syncMonthlyRecord = default_session_price_cents) - 10000 = 20000

        const result = await billingRepo.getDashboardAnalytics(tenant.id, '2025-01');
        expect(result.currentMonth.pendingCents).toBe(20000);
    });

    it('#8 — pós-cutover: group_payment pendente com due_date vencido conta; due_date futuro não conta', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        await approveCutover(tenant.id, '2020-01-01T00:00:00Z');

        const group = await createGroup(pool, tenant.id);
        const memberId = await addGroupMember(pool, group.id, patient.id, tenant.id, '2025-01-01');

        // Vencida (due_date no passado distante) — deve contar.
        await pool.query(`
            INSERT INTO group_payments (
                id, tenant_id, group_id, patient_id, group_member_id, charge_type,
                reference_month, amount_cents, original_amount_cents, status, due_date
            ) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'monthly', '2025-01', 7000, 7000, 'pending', '2025-01-10')
        `, [tenant.id, group.id, patient.id, memberId]);

        // A vencer no futuro distante — não deve contar.
        await pool.query(`
            INSERT INTO group_payments (
                id, tenant_id, group_id, patient_id, group_member_id, charge_type,
                reference_month, amount_cents, original_amount_cents, status, due_date
            ) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'monthly', '2099-01', 9000, 9000, 'pending', '2099-01-10')
        `, [tenant.id, group.id, patient.id, memberId]);

        const result = await billingRepo.getDashboardAnalytics(tenant.id, '2025-01');
        expect(result.currentMonth.pendingCents).toBe(7000);
    });

    it('#9 — pré-cutover (legado): fórmula "monthly" prorrateia por sessões decorridas', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        // expected=4, absences=0, paid=1, price=10000 → (4-0-1) * 10000/(4-0) - 0 = 7500
        await createMonthlyRecord(pool, tenant.id, patient.id, {
            month: '2025-01', paymentType: 'monthly', sessionPriceCents: 10000,
            expectedSessions: 4, paidSessions: 1, absences: 0, paymentStatus: 'partial',
        });

        const result = await billingRepo.getDashboardAnalytics(tenant.id, '2025-01');
        expect(result.currentMonth.pendingCents).toBe(7500);
    });

    it('#10 — pré-cutover (legado): fórmula per_session (else) usa valor cheio por sessão faltante', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        // expected=4, absences=1, paid=1, price=10000 → GREATEST(4-1-1,0) * 10000 - 0 = 20000
        await createMonthlyRecord(pool, tenant.id, patient.id, {
            month: '2025-01', paymentType: 'per_session', sessionPriceCents: 10000,
            expectedSessions: 4, paidSessions: 1, absences: 1, paymentStatus: 'partial',
        });

        const result = await billingRepo.getDashboardAnalytics(tenant.id, '2025-01');
        expect(result.currentMonth.pendingCents).toBe(20000);
    });

    it('#11 — pré-cutover: registro com payment_status = paid não conta como pendente', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        await createMonthlyRecord(pool, tenant.id, patient.id, {
            month: '2025-01', paymentType: 'monthly', sessionPriceCents: 10000,
            expectedSessions: 4, paidSessions: 4, absences: 0, paymentStatus: 'paid',
        });

        const result = await billingRepo.getDashboardAnalytics(tenant.id, '2025-01');
        expect(result.currentMonth.pendingCents).toBe(0);
    });
});

describe('PostgresBillingRepository.getDashboardAnalytics — isolamento por tenant', () => {
    it('#12 — dados de outro tenant não vazam pro resultado', async () => {
        const tenantA = await createTenant(pool);
        const tenantB = await createTenant(pool);
        const patientA = await createPatient(pool, tenantA.id);
        const patientB = await createPatient(pool, tenantB.id);

        await approveCutover(tenantA.id, '2025-01-01T00:00:00Z');
        await approveCutover(tenantB.id, '2025-01-01T00:00:00Z');

        await billingRepo.registerPayment(basePaymentDto({
            tenantId: tenantA.id, patientId: patientA.id, createdBy: tenantA.id,
            amountCents: 10000, paidAt: new Date('2025-06-10T12:00:00Z'),
        }));
        await billingRepo.registerPayment(basePaymentDto({
            tenantId: tenantB.id, patientId: patientB.id, createdBy: tenantB.id,
            amountCents: 99999, paidAt: new Date('2025-06-10T12:00:00Z'),
        }));

        const result = await billingRepo.getDashboardAnalytics(tenantA.id, '2025-06');
        expect(result.currentMonth.revenueCents).toBe(10000);
    });
});
