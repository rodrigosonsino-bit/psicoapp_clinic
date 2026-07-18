/**
 * postgresBillingRepositoryPayments.integration.test.ts
 *
 * Testes de integração contra PostgreSQL real para PostgresBillingRepository.registerPayment
 * e .voidPayment — extraídos de PostgresPsychotherapyRepository (ver
 * postgres_psychotherapy_repository_split, memória de sessão) e até aqui só verificados por
 * diff mecânico + build, nunca por teste automatizado rodando contra um banco de verdade.
 *
 * Cobre especificamente: idempotência, validação net+fee=amount, NotFoundError de monthlyRecordId
 * inexistente, dupla-baixa de voidPayment, e a regressão de colunas de audit_logs corrigida em
 * 2026-07-08 (aggregate_type/aggregate_id/operator_id/justification, não target_type/target_id/
 * created_by).
 */

import 'reflect-metadata';
import { Pool } from 'pg';
import { getTestPool, teardownTestDb, truncateTables } from './helpers/testDb';
import { createTenant, createPatient, createMonthlyRecord } from './helpers/fixtures';
import { PostgresBillingRepository } from '../../infrastructure/repositories/PostgresBillingRepository';
import { PostgresExpenseRepository } from '../../infrastructure/repositories/PostgresExpenseRepository';
import { NotFoundError } from '../../domain/errors/NotFoundError';
import { AppError } from '../../domain/errors/AppError';
import { RegisterPaymentDTO } from '../../domain/repositories/IPsychotherapyRepository';

jest.setTimeout(120_000);

const TABLES = [
    'audit_logs', 'financial_payments', 'psychotherapy_monthly_records',
    'psychotherapy_patients', 'tenants',
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

function basePaymentDto(overrides: Partial<RegisterPaymentDTO> = {}): RegisterPaymentDTO {
    return {
        tenantId: overrides.tenantId!,
        patientId: overrides.patientId!,
        monthlyRecordId: overrides.monthlyRecordId,
        amountCents: overrides.amountCents ?? 15000,
        paidAt: overrides.paidAt ?? new Date('2025-01-15T12:00:00Z'),
        method: overrides.method ?? 'pix',
        source: overrides.source ?? 'manual',
        idempotencyKey: overrides.idempotencyKey ?? `idem-${Math.random().toString(36).slice(2)}`,
        createdBy: overrides.createdBy!,
        netAmountCents: overrides.netAmountCents,
        processingFeeCents: overrides.processingFeeCents,
    };
}

describe('PostgresBillingRepository.registerPayment', () => {
    it('grava o pagamento com status confirmed e net=amount/fee=0 quando não informados', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);

        const payment = await billingRepo.registerPayment(
            basePaymentDto({ tenantId: tenant.id, patientId: patient.id, createdBy: tenant.id, amountCents: 20000 })
        );

        expect(payment.status).toBe('confirmed');
        expect(payment.amountCents).toBe(20000);
        expect(payment.netAmountCents).toBe(20000);
        expect(payment.processingFeeCents).toBe(0);

        const row = await pool.query('SELECT * FROM financial_payments WHERE id = $1', [payment.id]);
        expect(row.rows).toHaveLength(1);
    });

    it('é idempotente: repetir a mesma idempotencyKey retorna o pagamento original sem duplicar linha', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const dto = basePaymentDto({ tenantId: tenant.id, patientId: patient.id, createdBy: tenant.id, idempotencyKey: 'fixed-key-1' });

        const first = await billingRepo.registerPayment(dto);
        const second = await billingRepo.registerPayment(dto);

        expect(second.id).toBe(first.id);

        const count = await pool.query(
            'SELECT COUNT(*) FROM financial_payments WHERE tenant_id = $1 AND idempotency_key = $2',
            [tenant.id, 'fixed-key-1']
        );
        expect(Number(count.rows[0].count)).toBe(1);
    });

    it('lança AppError 400 quando netAmountCents + processingFeeCents != amountCents', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);

        await expect(billingRepo.registerPayment(
            basePaymentDto({
                tenantId: tenant.id, patientId: patient.id, createdBy: tenant.id,
                amountCents: 10000, netAmountCents: 9000, processingFeeCents: 500,
            })
        )).rejects.toThrow(AppError);

        const count = await pool.query('SELECT COUNT(*) FROM financial_payments WHERE tenant_id = $1', [tenant.id]);
        expect(Number(count.rows[0].count)).toBe(0);
    });

    it('lança NotFoundError quando monthlyRecordId não existe, sem gravar o pagamento', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);

        await expect(billingRepo.registerPayment(
            basePaymentDto({
                tenantId: tenant.id, patientId: patient.id, createdBy: tenant.id,
                monthlyRecordId: '00000000-0000-0000-0000-000000000000',
            })
        )).rejects.toThrow(NotFoundError);

        const count = await pool.query('SELECT COUNT(*) FROM financial_payments WHERE tenant_id = $1', [tenant.id]);
        expect(Number(count.rows[0].count)).toBe(0);
    });

    it('associa e persiste monthlyRecordId quando o registro existe', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const record = await createMonthlyRecord(pool, tenant.id, patient.id);

        const payment = await billingRepo.registerPayment(
            basePaymentDto({ tenantId: tenant.id, patientId: patient.id, createdBy: tenant.id, monthlyRecordId: record.id })
        );

        expect(payment.monthlyRecordId).toBe(record.id);
    });

    it('lança NotFoundError (em vez de travar a linha) quando monthlyRecordId pertence a outro tenant', async () => {
        const tenant = await createTenant(pool);
        const otherTenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const otherPatient = await createPatient(pool, otherTenant.id);
        const otherTenantRecord = await createMonthlyRecord(pool, otherTenant.id, otherPatient.id);

        await expect(billingRepo.registerPayment(
            basePaymentDto({
                tenantId: tenant.id, patientId: patient.id, createdBy: tenant.id,
                monthlyRecordId: otherTenantRecord.id,
            })
        )).rejects.toThrow(NotFoundError);

        const count = await pool.query('SELECT COUNT(*) FROM financial_payments WHERE tenant_id = $1', [tenant.id]);
        expect(Number(count.rows[0].count)).toBe(0);
    });
});

describe('PostgresBillingRepository.voidPayment', () => {
    async function registerConfirmedPayment(tenant: { id: string }, patient: { id: string }) {
        return billingRepo.registerPayment(
            basePaymentDto({ tenantId: tenant.id, patientId: patient.id, createdBy: tenant.id })
        );
    }

    it('marca o pagamento como voided e grava voidedAt/voidedBy/voidReason', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const payment = await registerConfirmedPayment(tenant, patient);

        const voided = await billingRepo.voidPayment(tenant.id, payment.id, tenant.id, 'Pagamento em duplicidade');

        expect(voided.status).toBe('voided');
        expect(voided.voidedBy).toBe(tenant.id);
        expect(voided.voidReason).toBe('Pagamento em duplicidade');
        expect(voided.voidedAt).not.toBeNull();
    });

    it('grava uma linha em audit_logs com as colunas reais do schema (aggregate_type/aggregate_id/operator_id/justification)', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const payment = await registerConfirmedPayment(tenant, patient);

        await billingRepo.voidPayment(tenant.id, payment.id, tenant.id, 'Estorno de teste');

        const log = await pool.query(
            `SELECT aggregate_type, aggregate_id, action, operator_id, justification
             FROM audit_logs WHERE tenant_id = $1 AND aggregate_id = $2`,
            [tenant.id, payment.id]
        );
        expect(log.rows).toHaveLength(1);
        expect(log.rows[0]).toMatchObject({
            aggregate_type: 'financial_payment',
            action: 'void_payment',
            operator_id: tenant.id,
            justification: 'Estorno de teste',
        });
    });

    it('lança AppError 400 ao tentar estornar um pagamento já voided (dupla baixa)', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const payment = await registerConfirmedPayment(tenant, patient);

        await billingRepo.voidPayment(tenant.id, payment.id, tenant.id, 'Primeiro estorno');

        await expect(
            billingRepo.voidPayment(tenant.id, payment.id, tenant.id, 'Segundo estorno')
        ).rejects.toThrow(AppError);
    });

    it('lança NotFoundError para pagamento inexistente ou de outro tenant', async () => {
        const tenant = await createTenant(pool);
        const otherTenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const payment = await registerConfirmedPayment(tenant, patient);

        await expect(
            billingRepo.voidPayment(otherTenant.id, payment.id, otherTenant.id, 'Tentativa de outro tenant')
        ).rejects.toThrow(NotFoundError);
    });
});
