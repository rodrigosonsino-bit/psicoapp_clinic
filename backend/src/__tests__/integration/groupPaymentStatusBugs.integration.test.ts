/**
 * groupPaymentStatusBugs.integration.test.ts
 *
 * Testes de REGRESSÃO para os dois bugs de cálculo de pagamento de grupo encontrados na
 * auditoria de 03/07/2026 e confirmados por revisão externa (Codex CLI). Começaram como
 * testes de CARACTERIZAÇÃO (documentando o comportamento buggy como baseline antes da
 * correção); os dois bugs já foram corrigidos, então os asserts abaixo já refletem o
 * comportamento CORRETO — se algum regredir, um destes testes falha.
 *
 * 1. GroupController.listGroupMembers (GET /psychotherapy/groups/:groupId/members) somava
 *    SUM(gp.amount_cents) de TODOS os group_payments do mês, sem filtrar por status —
 *    cobranças 'pending' (nunca pagas) ou 'voided' (estornadas) contavam como se já
 *    estivessem pagas. CORRIGIDO pelo Antigravity (commit 58c6a4e, 03/07/2026): a query
 *    agora usa `FILTER (WHERE gp.status = 'paid' AND gp.charge_type = 'monthly')`.
 *
 * 2. GroupController.listGroupPayments (GET /psychotherapy/groups/:groupId/payments) filtrava
 *    corretamente por status='paid', mas somava gp.amount_cents (valor NOMINAL da cobrança)
 *    em vez de gp.amount_paid_cents (valor EFETIVAMENTE confirmado) — divergia sempre que
 *    ConfirmGroupPaymentUseCase é chamado com amountPaidCents diferente do valor nominal
 *    (ex: desconto negociado, pagamento parcial aceito como quitação). CORRIGIDO nesta sessão
 *    (04/07/2026): troca de `SUM(gp.amount_cents)` para `SUM(gp.amount_paid_cents)` nas 3
 *    agregações relevantes. Seguro porque a migration de `amount_paid_cents` tem CHECK
 *    constraint garantindo NOT NULL sempre que status='paid' (com backfill de linhas antigas).
 */

import 'reflect-metadata';
import { Pool } from 'pg';
import { mock } from 'jest-mock-extended';
import { Request, Response } from 'express';
import { getTestPool, teardownTestDb, truncateTables } from './helpers/testDb';
import { createTenant, createGroup, createPatient, addGroupMember, createGroupPayment } from './helpers/fixtures';
import { GroupController } from '../../presentation/controllers/GroupController';
import { RegisterGroupSessionUseCase } from '../../application/useCases/RegisterGroupSessionUseCase';
import { CreateGroupChargesUseCase } from '../../application/useCases/CreateGroupChargesUseCase';
import { ConfirmGroupPaymentUseCase } from '../../application/useCases/ConfirmGroupPaymentUseCase';
import { VoidGroupPaymentUseCase } from '../../application/useCases/VoidGroupPaymentUseCase';
import { ReplaceGroupChargeUseCase } from '../../application/useCases/ReplaceGroupChargeUseCase';
import { AddGroupMemberIdempotentUseCase } from '../../application/useCases/AddGroupMemberIdempotentUseCase';
import { AttachExistingGroupMemberUseCase } from '../../application/useCases/AttachExistingGroupMemberUseCase';
import { CreateUpfrontCourseChargeUseCase } from '../../application/useCases/CreateUpfrontCourseChargeUseCase';
import { RefundUpfrontCourseUseCase } from '../../application/useCases/RefundUpfrontCourseUseCase';
import { CancelPolicyUseCase } from '../../application/useCases/CancelPolicyUseCase';
import { AdvanceInstallmentsUseCase } from '../../application/useCases/AdvanceInstallmentsUseCase';

jest.setTimeout(120_000);

const TABLES = [
    'financial_payments', 'group_payments', 'group_session_records',
    'therapy_group_members', 'therapy_groups',
    'psychotherapy_patients', 'tenants',
];

let pool: Pool;
let controller: GroupController;

function mockRes(): Response {
    const res = {} as Response;
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

function mockReq(tenantId: string, params: Record<string, string>, query: Record<string, string> = {}): Request {
    return { params, query, tenantId } as unknown as Request;
}

beforeAll(async () => {
    pool = await getTestPool();
    controller = new GroupController(
        pool,
        mock<RegisterGroupSessionUseCase>(),
        mock<CreateGroupChargesUseCase>(),
        mock<ConfirmGroupPaymentUseCase>(),
        mock<VoidGroupPaymentUseCase>(),
        mock<ReplaceGroupChargeUseCase>(),
        mock<AddGroupMemberIdempotentUseCase>(),
        mock<AttachExistingGroupMemberUseCase>(),
        mock<CreateUpfrontCourseChargeUseCase>(),
        mock<RefundUpfrontCourseUseCase>(),
        mock<CancelPolicyUseCase>(),
        mock<AdvanceInstallmentsUseCase>(),
    );
});

afterAll(async () => {
    await teardownTestDb();
});

afterEach(async () => {
    await truncateTables(pool, TABLES);
});

describe('[REGRESSÃO] GroupController.listGroupMembers — soma deve respeitar status', () => {
    it('cobrança "pending" (nunca paga) NÃO faz o membro aparecer como "paid"', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const group = await createGroup(pool, tenant.id, { monthlyFeeCents: 20000 });
        const memberId = await addGroupMember(pool, group.id, patient.id, tenant.id);

        await createGroupPayment(pool, {
            tenantId: tenant.id, groupId: group.id, patientId: patient.id,
            groupMemberId: memberId, amountCents: 20000,
            referenceMonth: '2025-01', status: 'pending',
        });

        const req = mockReq(tenant.id, { groupId: group.id }, { month: '2025-01' });
        const res = mockRes();
        await controller.listGroupMembers(req, res);

        const payload = (res.json as jest.Mock).mock.calls[0][0];
        const member = payload.data.find((m: { patient_id: string }) => m.patient_id === patient.id);

        expect(member.payment_status).toBe('pending');
    });

    it('cobrança "voided" (estornada) NÃO conta pro status de pagamento', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const group = await createGroup(pool, tenant.id, { monthlyFeeCents: 20000 });
        const memberId = await addGroupMember(pool, group.id, patient.id, tenant.id);

        await createGroupPayment(pool, {
            tenantId: tenant.id, groupId: group.id, patientId: patient.id,
            groupMemberId: memberId, amountCents: 20000,
            referenceMonth: '2025-02', status: 'voided',
        });

        const req = mockReq(tenant.id, { groupId: group.id }, { month: '2025-02' });
        const res = mockRes();
        await controller.listGroupMembers(req, res);

        const payload = (res.json as jest.Mock).mock.calls[0][0];
        const member = payload.data.find((m: { patient_id: string }) => m.patient_id === patient.id);

        expect(member.payment_status).toBe('pending');
    });

    it('cobrança "paid" corretamente conta como paga', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const group = await createGroup(pool, tenant.id, { monthlyFeeCents: 20000 });
        const memberId = await addGroupMember(pool, group.id, patient.id, tenant.id);

        await createGroupPayment(pool, {
            tenantId: tenant.id, groupId: group.id, patientId: patient.id,
            groupMemberId: memberId, amountCents: 20000,
            referenceMonth: '2025-04', status: 'paid',
        });

        const req = mockReq(tenant.id, { groupId: group.id }, { month: '2025-04' });
        const res = mockRes();
        await controller.listGroupMembers(req, res);

        const payload = (res.json as jest.Mock).mock.calls[0][0];
        const member = payload.data.find((m: { patient_id: string }) => m.patient_id === patient.id);

        expect(member.payment_status).toBe('paid');
    });
});

describe('[REGRESSÃO] GroupController.listGroupPayments — total_paid_cents deve usar o valor efetivamente pago', () => {
    it('total_paid_cents usa amount_paid_cents (efetivo), não amount_cents (nominal)', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const group = await createGroup(pool, tenant.id, { monthlyFeeCents: 20000 });
        const memberId = await addGroupMember(pool, group.id, patient.id, tenant.id);

        const payment = await createGroupPayment(pool, {
            tenantId: tenant.id, groupId: group.id, patientId: patient.id,
            groupMemberId: memberId, amountCents: 20000,
            referenceMonth: '2025-03', status: 'pending',
        });

        // Simula ConfirmGroupPaymentUseCase aceitando um valor MENOR que o nominal como
        // quitação (ex: desconto negociado) — amount_paid_cents diverge de amount_cents,
        // exatamente como o use case real permite (ver ConfirmGroupPaymentUseCase.ts:56).
        await pool.query(`
            UPDATE group_payments
            SET status = 'paid', amount_paid_cents = 15000, paid_at = NOW(), payment_method = 'pix'
            WHERE id = $1
        `, [payment.id]);

        const req = mockReq(tenant.id, { groupId: group.id }, { month: '2025-03' });
        const res = mockRes();
        await controller.listGroupPayments(req, res);

        const payload = (res.json as jest.Mock).mock.calls[0][0];
        const row = payload.data.find((m: { patient_id: string }) => m.patient_id === patient.id);

        // Valor efetivamente recebido (15000), não o valor nominal da cobrança (20000).
        expect(row.total_paid_cents).toBe(15000);
    });

    it('quando não há desconto, total_paid_cents coincide com o valor nominal (caso comum)', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const group = await createGroup(pool, tenant.id, { monthlyFeeCents: 20000 });
        const memberId = await addGroupMember(pool, group.id, patient.id, tenant.id);

        const payment = await createGroupPayment(pool, {
            tenantId: tenant.id, groupId: group.id, patientId: patient.id,
            groupMemberId: memberId, amountCents: 20000,
            referenceMonth: '2025-05', status: 'pending',
        });

        await pool.query(`
            UPDATE group_payments
            SET status = 'paid', amount_paid_cents = amount_cents, paid_at = NOW(), payment_method = 'pix'
            WHERE id = $1
        `, [payment.id]);

        const req = mockReq(tenant.id, { groupId: group.id }, { month: '2025-05' });
        const res = mockRes();
        await controller.listGroupPayments(req, res);

        const payload = (res.json as jest.Mock).mock.calls[0][0];
        const row = payload.data.find((m: { patient_id: string }) => m.patient_id === patient.id);

        expect(row.total_paid_cents).toBe(20000);
    });
});
