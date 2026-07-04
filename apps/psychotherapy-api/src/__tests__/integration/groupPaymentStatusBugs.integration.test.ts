/**
 * groupPaymentStatusBugs.integration.test.ts
 *
 * Testes de CARACTERIZAÇÃO (não de correção) dos bugs de cálculo de pagamento de grupo
 * encontrados na auditoria de 03/07/2026 e confirmados por revisão externa (Codex CLI):
 *
 * 1. GroupController.listGroupMembers (GET /psychotherapy/groups/:groupId/members) soma
 *    SUM(gp.amount_cents) de TODOS os group_payments do mês, sem filtrar por status —
 *    cobranças 'pending' (nunca pagas) ou 'voided' (estornadas) contam como se já
 *    estivessem pagas, podendo fazer um membro aparecer como "paid" indevidamente.
 *
 * 2. GroupController.listGroupPayments (GET /psychotherapy/groups/:groupId/payments) filtra
 *    corretamente por status='paid', mas soma gp.amount_cents (valor NOMINAL da cobrança)
 *    em vez de gp.amount_paid_cents (valor EFETIVAMENTE confirmado) — diverge sempre que
 *    ConfirmGroupPaymentUseCase é chamado com amountPaidCents diferente do valor nominal
 *    (ex: desconto negociado, pagamento parcial aceito como quitação).
 *
 * Estes testes documentam o comportamento ATUAL (com os bugs) como baseline. Ao corrigir
 * os bugs (fase 4 do plano de correções — "corrigir cálculo de pagamento de grupo"), os
 * asserts marcados com "← comportamento errado, documentado" devem ser invertidos para
 * o valor correto, e o teste passa a ser a prova de que a correção funciona.
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

describe('[CARACTERIZAÇÃO] GroupController.listGroupMembers — soma ignora status', () => {
    it('BUG: cobrança "pending" (nunca paga) faz o membro aparecer como "paid"', async () => {
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

        // Comportamento ATUAL (com bug): a query soma SUM(gp.amount_cents) sem
        // FILTER (WHERE status = 'paid'), então uma cobrança pendente já basta pra "paid".
        // Pós-fix esperado: 'pending'.
        expect(member.payment_status).toBe('paid'); // ← comportamento errado, documentado
    });

    it('BUG: cobrança "voided" (estornada) ainda conta pro status de pagamento', async () => {
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

        // Comportamento ATUAL (com bug): estorno não é excluído da soma.
        // Pós-fix esperado: 'pending' (nenhuma cobrança realmente paga existe).
        expect(member.payment_status).toBe('paid'); // ← comportamento errado, documentado
    });

    it('referência (não-bug): cobrança "paid" corretamente conta como paga', async () => {
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

        expect(member.payment_status).toBe('paid'); // este caso já está correto hoje
    });
});

describe('[CARACTERIZAÇÃO] GroupController.listGroupPayments — soma valor nominal em vez do pago', () => {
    it('BUG: total_paid_cents usa amount_cents (nominal), não amount_paid_cents (efetivo)', async () => {
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

        // Comportamento ATUAL (com bug): usa o valor NOMINAL (20000), não o efetivamente
        // pago (15000) — o psicólogo veria "recebido: R$200" quando na verdade recebeu R$150.
        // Pós-fix esperado: total_paid_cents === 15000.
        expect(row.total_paid_cents).toBe(20000); // ← comportamento errado, documentado
    });
});
