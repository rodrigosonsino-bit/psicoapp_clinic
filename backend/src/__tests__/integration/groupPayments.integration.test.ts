/**
 * groupPayments.integration.test.ts
 *
 * Testes de integração para ConfirmGroupPaymentUseCase e VoidGroupPaymentUseCase.
 * Valida o contrato completo com PostgreSQL real: group_payment_id no ledger,
 * idempotência forte, estorno com rowCount === 1 e integridade da trigger 056.
 *
 * Cenários do plano: #5, #6, #7, #8, #9
 */

import 'reflect-metadata';
import { Pool } from 'pg';
import { getTestPool, teardownTestDb, truncateTables } from './helpers/testDb';
import { createTenant, createGroup, createPatient, addGroupMember, createGroupPayment } from './helpers/fixtures';
import { ConfirmGroupPaymentUseCase } from '../../application/useCases/ConfirmGroupPaymentUseCase';
import { VoidGroupPaymentUseCase } from '../../application/useCases/VoidGroupPaymentUseCase';

jest.setTimeout(120_000);

const TABLES = [
    'financial_payments', 'group_payments', 'group_session_records',
    'therapy_group_members', 'therapy_groups',
    'psychotherapy_patients', 'tenants',
];

let pool: Pool;
let confirmUseCase: ConfirmGroupPaymentUseCase;
let voidUseCase: VoidGroupPaymentUseCase;

beforeAll(async () => {
    pool = await getTestPool();
    confirmUseCase = new ConfirmGroupPaymentUseCase(pool);
    voidUseCase    = new VoidGroupPaymentUseCase(pool);
});

afterAll(async () => {
    await teardownTestDb();
});

afterEach(async () => {
    await truncateTables(pool, TABLES);
});

// ── Cenário #5 — Confirmação grava group_payment_id no ledger ─────────────────

describe('ConfirmGroupPaymentUseCase', () => {
    it('#5 — grava group_payment_id em financial_payments após confirmação', async () => {
        const tenant  = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const group   = await createGroup(pool, tenant.id);
        const memberId = await addGroupMember(pool, group.id, patient.id, tenant.id);
        const payment = await createGroupPayment(pool, {
            tenantId: tenant.id, groupId: group.id,
            patientId: patient.id, groupMemberId: memberId, amountCents: 15000,
        });

        await confirmUseCase.execute({
            tenantId: tenant.id,
            groupPaymentId: payment.id,
            operatorId: tenant.id, paymentMethod: 'pix',
        });

        const ledger = await pool.query(
            `SELECT group_payment_id, patient_id, amount_cents, status
             FROM financial_payments
             WHERE group_payment_id = $1`,
            [payment.id]
        );

        expect(ledger.rows).toHaveLength(1);
        expect(ledger.rows[0].group_payment_id).toBe(payment.id);
        expect(ledger.rows[0].patient_id).toBe(patient.id);
        expect(ledger.rows[0].amount_cents).toBe(15000);
        expect(ledger.rows[0].status).toBe('confirmed');
    });

    it('#5b — group_payment marcado como paid após confirmação', async () => {
        const tenant  = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const group   = await createGroup(pool, tenant.id);
        const memberId = await addGroupMember(pool, group.id, patient.id, tenant.id);
        const payment = await createGroupPayment(pool, {
            tenantId: tenant.id, groupId: group.id,
            patientId: patient.id, groupMemberId: memberId,
        });

        await confirmUseCase.execute({
            tenantId: tenant.id,
            groupPaymentId: payment.id,
            operatorId: tenant.id, paymentMethod: 'cash',
        });

        const gp = await pool.query(`SELECT status, amount_paid_cents FROM group_payments WHERE id = $1`, [payment.id]);
        expect(gp.rows[0].status).toBe('paid');
        expect(gp.rows[0].amount_paid_cents).not.toBeNull();
    });

    // Cenário #6
    it('#6 — confirmação concorrente do mesmo pagamento gera apenas 1 linha no ledger', async () => {
        const tenant  = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const group   = await createGroup(pool, tenant.id);
        const memberId = await addGroupMember(pool, group.id, patient.id, tenant.id);
        const payment = await createGroupPayment(pool, {
            tenantId: tenant.id, groupId: group.id, patientId: patient.id, groupMemberId: memberId,
        });

        // Executa as duas confirmações concorrentemente
        const [r1, r2] = await Promise.allSettled([
            confirmUseCase.execute({ tenantId: tenant.id, groupPaymentId: payment.id, operatorId: tenant.id, paymentMethod: 'pix' }),
            confirmUseCase.execute({ tenantId: tenant.id, groupPaymentId: payment.id, operatorId: tenant.id, paymentMethod: 'pix' }),
        ]);

        // Ambas devem resolver (uma é idempotente, não rejeita)
        expect(r1.status).toBe('fulfilled');
        expect(r2.status).toBe('fulfilled');

        const ledger = await pool.query(
            `SELECT COUNT(*) FROM financial_payments WHERE group_payment_id = $1`,
            [payment.id]
        );
        expect(Number(ledger.rows[0].count)).toBe(1);
    });

    // Cenário #7
    it('#7 — retorna 409 se ledger existente diverge do groupPaymentId', async () => {
        const tenant  = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const group   = await createGroup(pool, tenant.id);
        const memberId = await addGroupMember(pool, group.id, patient.id, tenant.id);
        const payment = await createGroupPayment(pool, {
            tenantId: tenant.id, groupId: group.id, patientId: patient.id, groupMemberId: memberId,
        });

        // Primeiro: confirmar normalmente
        await confirmUseCase.execute({
            tenantId: tenant.id, groupPaymentId: payment.id, operatorId: tenant.id, paymentMethod: 'pix',
        });

        // Criar novo payment pending para testar conflito
        const payment2 = await createGroupPayment(pool, {
            tenantId: tenant.id, groupId: group.id, patientId: patient.id, groupMemberId: memberId,
            referenceMonth: '2025-02',
        });

        // Inserir manualmente ledger com chave de idempotência do payment2 mas grupo_payment_id errado
        const wrongKey = `group_confirm_${payment2.id}`;
        const anotherPaymentId = (await createGroupPayment(pool, {
            tenantId: tenant.id, groupId: group.id, patientId: patient.id, groupMemberId: memberId,
            referenceMonth: '2025-03',
        })).id;

        await pool.query(`
            INSERT INTO financial_payments (
                id, tenant_id, patient_id, monthly_record_id,
                amount_cents, net_amount_cents, processing_fee_cents, currency, paid_at, method, source, status,
                idempotency_key, created_by, group_payment_id
            ) VALUES (
                gen_random_uuid(), $1, $2, NULL,
                20000, 20000, 0, 'BRL', NOW(), 'pix', 'manual', 'confirmed',
                $3, $1, $4
            )
        `, [tenant.id, patient.id, wrongKey, anotherPaymentId]);

        await expect(
            confirmUseCase.execute({
                tenantId: tenant.id, groupPaymentId: payment2.id, operatorId: tenant.id, paymentMethod: 'pix',
            })
        ).rejects.toMatchObject({ statusCode: 409 });
    });
});

// ── Cenário #8 e #9 — Estorno ────────────────────────────────────────────────

describe('VoidGroupPaymentUseCase', () => {
    it('#8 — estorno de cobrança paga atualiza ledger (rowCount = 1)', async () => {
        const tenant  = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const group   = await createGroup(pool, tenant.id);
        const memberId = await addGroupMember(pool, group.id, patient.id, tenant.id);
        const payment = await createGroupPayment(pool, {
            tenantId: tenant.id, groupId: group.id, patientId: patient.id, groupMemberId: memberId,
        });

        // Confirmar primeiro
        await confirmUseCase.execute({
            tenantId: tenant.id, groupPaymentId: payment.id, operatorId: tenant.id, paymentMethod: 'pix',
        });

        // Estornar
        await expect(
            voidUseCase.execute({ tenantId: tenant.id, groupPaymentId: payment.id, reason: 'Estorno de teste' })
        ).resolves.not.toThrow();

        // Verificar ledger estornado
        const ledger = await pool.query(
            `SELECT status, voided_at, voided_by, void_reason FROM financial_payments WHERE group_payment_id = $1`,
            [payment.id]
        );
        expect(ledger.rows[0].status).toBe('voided');
        expect(ledger.rows[0].voided_at).not.toBeNull();
        expect(ledger.rows[0].voided_by).toBe(tenant.id);
        expect(ledger.rows[0].void_reason).toBe('Estorno de teste');

        // Verificar group_payment estornado
        const gp = await pool.query(`SELECT status, voided_by FROM group_payments WHERE id = $1`, [payment.id]);
        expect(gp.rows[0].status).toBe('voided');
        expect(gp.rows[0].voided_by).toBe(tenant.id);
    });

    it('#9 — estorno de cobrança paid sem ledger retorna erro 500 e faz rollback', async () => {
        const tenant  = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const group   = await createGroup(pool, tenant.id);
        const memberId = await addGroupMember(pool, group.id, patient.id, tenant.id);
        const payment = await createGroupPayment(pool, {
            tenantId: tenant.id, groupId: group.id, patientId: patient.id, groupMemberId: memberId,
        });

        // Marcar como paid diretamente sem criar ledger — estado inválido controlado
        await pool.query(`
            UPDATE group_payments
            SET status = 'paid', amount_paid_cents = 20000, paid_at = NOW(), payment_method = 'pix'
            WHERE id = $1
        `, [payment.id]);

        await expect(
            voidUseCase.execute({ tenantId: tenant.id, groupPaymentId: payment.id, reason: 'Teste de erro' })
        ).rejects.toMatchObject({ statusCode: 500 });

        // group_payment NÃO deve ter sido alterado (rollback)
        const gp = await pool.query(`SELECT status FROM group_payments WHERE id = $1`, [payment.id]);
        expect(gp.rows[0].status).toBe('paid');
    });
});
