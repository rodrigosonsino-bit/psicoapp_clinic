/**
 * groupUpfrontPayment.integration.test.ts
 *
 * Testes de integração pra feature de modelo bruto/taxa/líquido (migration 080) +
 * cobrança à vista de curso (CreateUpfrontCourseChargeUseCase / ConfirmGroupPaymentUseCase),
 * implementada a partir da "Revisão Final" auditada (04/07/2026).
 *
 * Cobre o plano de testes daquela revisão:
 * 1. Confirmação com líquido zero → 400.
 * 2. Retentativa com valor líquido divergente → 409 (idempotência não sobrescreve silenciosamente).
 * 3. Upfront com mensalidades já pagas → cobra só o saldo restante, sem duplicar cobrança.
 * 4. Upfront quando já quitado via mensalidades → rejeita (409), não cobra valor negativo/zero.
 * 5. Confirmar upfront anula mensalidades futuras pendentes, mas preserva inadimplência anterior.
 * 6. Trigger de imutabilidade do ledger bloqueia edição direta de net_amount_cents/processing_fee_cents.
 */

import 'reflect-metadata';
import { Pool } from 'pg';
import { getTestPool, teardownTestDb, truncateTables } from './helpers/testDb';
import { createTenant, createGroup, createPatient, addGroupMember, createGroupPayment } from './helpers/fixtures';
import { ConfirmGroupPaymentUseCase } from '../../application/useCases/ConfirmGroupPaymentUseCase';
import { CreateUpfrontCourseChargeUseCase } from '../../application/useCases/CreateUpfrontCourseChargeUseCase';

jest.setTimeout(120_000);

const TABLES = [
    'therapy_group_member_billing_policies', 'financial_payments', 'group_payments',
    'group_session_records', 'therapy_group_members', 'therapy_groups',
    'psychotherapy_patients', 'tenants',
];

let pool: Pool;
let confirmUseCase: ConfirmGroupPaymentUseCase;
let createUpfrontUseCase: CreateUpfrontCourseChargeUseCase;

beforeAll(async () => {
    pool = await getTestPool();
    confirmUseCase = new ConfirmGroupPaymentUseCase(pool);
    createUpfrontUseCase = new CreateUpfrontCourseChargeUseCase(pool);
});

afterAll(async () => {
    await teardownTestDb();
});

afterEach(async () => {
    await truncateTables(pool, TABLES);
});

function isoDateOffsetDays(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

describe('[REGRESSÃO] ConfirmGroupPaymentUseCase — modelo bruto/taxa/líquido', () => {
    it('#1 — confirmação com líquido zero é rejeitada (400)', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const group = await createGroup(pool, tenant.id);
        const memberId = await addGroupMember(pool, group.id, patient.id, tenant.id);
        const payment = await createGroupPayment(pool, {
            tenantId: tenant.id, groupId: group.id, patientId: patient.id,
            groupMemberId: memberId, amountCents: 10000,
        });

        await expect(
            confirmUseCase.execute({
                tenantId: tenant.id, operatorId: tenant.id, groupPaymentId: payment.id,
                paymentMethod: 'credit_card', netAmountCents: 0,
            })
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('#2 — retentativa com valor líquido divergente retorna 409 (não sobrescreve o ledger)', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const group = await createGroup(pool, tenant.id);
        const memberId = await addGroupMember(pool, group.id, patient.id, tenant.id);
        const payment = await createGroupPayment(pool, {
            tenantId: tenant.id, groupId: group.id, patientId: patient.id,
            groupMemberId: memberId, amountCents: 10000,
        });

        await confirmUseCase.execute({
            tenantId: tenant.id, operatorId: tenant.id, groupPaymentId: payment.id,
            paymentMethod: 'credit_card', amountPaidCents: 10000, netAmountCents: 9500,
        });

        // Segunda tentativa com líquido diferente pro MESMO groupPaymentId
        await expect(
            confirmUseCase.execute({
                tenantId: tenant.id, operatorId: tenant.id, groupPaymentId: payment.id,
                paymentMethod: 'credit_card', amountPaidCents: 10000, netAmountCents: 9000,
            })
        ).rejects.toMatchObject({ statusCode: 409 });

        // Ledger permanece com o valor da primeira confirmação (imutável)
        const ledger = await pool.query(
            `SELECT net_amount_cents, processing_fee_cents FROM financial_payments WHERE group_payment_id = $1`,
            [payment.id]
        );
        expect(ledger.rows[0].net_amount_cents).toBe(9500);
        expect(ledger.rows[0].processing_fee_cents).toBe(500);
    });

    it('#3 — sem taxa informada, líquido = bruto (fee = 0)', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const group = await createGroup(pool, tenant.id);
        const memberId = await addGroupMember(pool, group.id, patient.id, tenant.id);
        const payment = await createGroupPayment(pool, {
            tenantId: tenant.id, groupId: group.id, patientId: patient.id,
            groupMemberId: memberId, amountCents: 15000,
        });

        await confirmUseCase.execute({
            tenantId: tenant.id, operatorId: tenant.id, groupPaymentId: payment.id,
            paymentMethod: 'pix', amountPaidCents: 15000,
        });

        const gp = await pool.query(
            `SELECT net_amount_cents, processing_fee_cents FROM group_payments WHERE id = $1`,
            [payment.id]
        );
        expect(gp.rows[0].net_amount_cents).toBe(15000);
        expect(gp.rows[0].processing_fee_cents).toBe(0);
    });
});

describe('[REGRESSÃO] CreateUpfrontCourseChargeUseCase — saldo restante', () => {
    it('#4 — desconta mensalidades já pagas do valor cobrado à vista', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        // Curso de 6 meses, R$200/mês = R$1200 no total
        const group = await createGroup(pool, tenant.id, { monthlyFeeCents: 20000, durationMonths: 6 });
        const memberId = await addGroupMember(pool, group.id, patient.id, tenant.id);

        // 2 mensalidades já pagas (R$200 cada = R$400 já recebido)
        await createGroupPayment(pool, {
            tenantId: tenant.id, groupId: group.id, patientId: patient.id,
            groupMemberId: memberId, amountCents: 20000, status: 'paid',
            referenceMonth: '2025-01',
        });
        await createGroupPayment(pool, {
            tenantId: tenant.id, groupId: group.id, patientId: patient.id,
            groupMemberId: memberId, amountCents: 20000, status: 'paid',
            referenceMonth: '2025-02',
        });

        const result = await createUpfrontUseCase.execute({
            tenantId: tenant.id, groupId: group.id, groupMemberId: memberId, operatorId: tenant.id,
        });

        // 120000 (total) - 40000 (já pago) = 80000, NÃO 120000 (evita cobrança duplicada)
        expect(result.amountCents).toBe(80000);
    });

    it('#5 — rejeita (409) se as mensalidades já pagas cobrem o valor total do curso', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const group = await createGroup(pool, tenant.id, { monthlyFeeCents: 20000, durationMonths: 2 });
        const memberId = await addGroupMember(pool, group.id, patient.id, tenant.id);

        await createGroupPayment(pool, {
            tenantId: tenant.id, groupId: group.id, patientId: patient.id,
            groupMemberId: memberId, amountCents: 20000, status: 'paid', referenceMonth: '2025-01',
        });
        await createGroupPayment(pool, {
            tenantId: tenant.id, groupId: group.id, patientId: patient.id,
            groupMemberId: memberId, amountCents: 20000, status: 'paid', referenceMonth: '2025-02',
        });

        await expect(
            createUpfrontUseCase.execute({
                tenantId: tenant.id, groupId: group.id, groupMemberId: memberId, operatorId: tenant.id,
            })
        ).rejects.toMatchObject({ statusCode: 409 });
    });
});

describe('[REGRESSÃO] Confirmação de upfront anula só mensalidades futuras, preserva inadimplência anterior', () => {
    it('#6 — mensalidade pendente futura é anulada; mensalidade pendente vencida (passado) é preservada', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const group = await createGroup(pool, tenant.id, { monthlyFeeCents: 20000, durationMonths: 3 });
        const memberId = await addGroupMember(pool, group.id, patient.id, tenant.id);

        const overdue = await createGroupPayment(pool, {
            tenantId: tenant.id, groupId: group.id, patientId: patient.id,
            groupMemberId: memberId, amountCents: 20000, status: 'pending',
            dueDate: isoDateOffsetDays(-30), referenceMonth: '2025-01',
        });
        const future = await createGroupPayment(pool, {
            tenantId: tenant.id, groupId: group.id, patientId: patient.id,
            groupMemberId: memberId, amountCents: 20000, status: 'pending',
            dueDate: isoDateOffsetDays(30), referenceMonth: '2025-06',
        });

        const upfrontCharge = await createUpfrontUseCase.execute({
            tenantId: tenant.id, groupId: group.id, groupMemberId: memberId, operatorId: tenant.id,
        });

        await confirmUseCase.execute({
            tenantId: tenant.id, operatorId: tenant.id, groupPaymentId: upfrontCharge.chargeId,
            paymentMethod: 'pix',
        });

        const overdueRow = await pool.query(`SELECT status FROM group_payments WHERE id = $1`, [overdue.id]);
        const futureRow = await pool.query(`SELECT status, void_reason FROM group_payments WHERE id = $1`, [future.id]);

        expect(overdueRow.rows[0].status).toBe('pending'); // inadimplência anterior preservada
        expect(futureRow.rows[0].status).toBe('voided');   // coberta pelo upfront
        expect(futureRow.rows[0].void_reason).toMatch(/vista/i);
    });
});

describe('[REGRESSÃO] Trigger de imutabilidade do ledger (migration 080)', () => {
    it('#7 — bloqueia edição direta de net_amount_cents/processing_fee_cents após confirmação', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const group = await createGroup(pool, tenant.id);
        const memberId = await addGroupMember(pool, group.id, patient.id, tenant.id);
        const payment = await createGroupPayment(pool, {
            tenantId: tenant.id, groupId: group.id, patientId: patient.id,
            groupMemberId: memberId, amountCents: 10000,
        });

        await confirmUseCase.execute({
            tenantId: tenant.id, operatorId: tenant.id, groupPaymentId: payment.id,
            paymentMethod: 'pix', amountPaidCents: 10000, netAmountCents: 9700,
        });

        await expect(
            pool.query(
                `UPDATE financial_payments SET net_amount_cents = net_amount_cents - 100 WHERE group_payment_id = $1`,
                [payment.id]
            )
        ).rejects.toThrow(/imutáve/i);
    });
});
