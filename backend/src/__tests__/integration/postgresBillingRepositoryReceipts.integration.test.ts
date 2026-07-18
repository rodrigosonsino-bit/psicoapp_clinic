/**
 * postgresBillingRepositoryReceipts.integration.test.ts
 *
 * Testes de integração contra PostgreSQL real para PostgresBillingRepository.saveReceipt e
 * .deleteReceipt — ambos COMPLEXO (dual-write com financial_payments em direções opostas:
 * saveReceipt cria o payment junto, deleteReceipt reverte apagando os dois) e até aqui só
 * verificados por diff mecânico + build.
 *
 * Cobre: numeração sequencial por tenant (tenant_receipt_sequences), dual-write do
 * financial_payments correspondente, update de recibo existente (via id) sem criar novo
 * financial_payment, e deleteReceipt revertendo os dois lados do dual-write atomicamente.
 */

import 'reflect-metadata';
import { Pool } from 'pg';
import { getTestPool, teardownTestDb, truncateTables } from './helpers/testDb';
import { createTenant, createPatient } from './helpers/fixtures';
import { PostgresBillingRepository } from '../../infrastructure/repositories/PostgresBillingRepository';
import { PostgresExpenseRepository } from '../../infrastructure/repositories/PostgresExpenseRepository';
import { NotFoundError } from '../../domain/errors/NotFoundError';

jest.setTimeout(120_000);

const TABLES = [
    'financial_payments', 'psychotherapy_receipts', 'tenant_receipt_sequences',
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

describe('PostgresBillingRepository.saveReceipt', () => {
    it('gera receipt_number sequencial por tenant, começando em 1', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);

        const first = await billingRepo.saveReceipt({
            tenantId: tenant.id, patientId: patient.id, amountCents: 15000,
            issueDate: new Date('2025-02-10'), description: 'Sessão 1',
        });
        const second = await billingRepo.saveReceipt({
            tenantId: tenant.id, patientId: patient.id, amountCents: 15000,
            issueDate: new Date('2025-02-17'), description: 'Sessão 2',
        });

        expect(first.receiptNumber).toBe(1);
        expect(second.receiptNumber).toBe(2);
    });

    it('numera sequências independentes por tenant', async () => {
        const tenantA = await createTenant(pool);
        const tenantB = await createTenant(pool);
        const patientA = await createPatient(pool, tenantA.id);
        const patientB = await createPatient(pool, tenantB.id);

        const receiptA = await billingRepo.saveReceipt({
            tenantId: tenantA.id, patientId: patientA.id, amountCents: 10000,
            issueDate: new Date('2025-02-10'), description: 'A',
        });
        const receiptB = await billingRepo.saveReceipt({
            tenantId: tenantB.id, patientId: patientB.id, amountCents: 10000,
            issueDate: new Date('2025-02-10'), description: 'B',
        });

        expect(receiptA.receiptNumber).toBe(1);
        expect(receiptB.receiptNumber).toBe(1);
    });

    it('grava um financial_payment correspondente (dual-write) com o mesmo valor', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);

        const receipt = await billingRepo.saveReceipt({
            tenantId: tenant.id, patientId: patient.id, amountCents: 42000,
            issueDate: new Date('2025-02-10'), description: 'Sessão',
        });

        const payment = await pool.query(
            'SELECT * FROM financial_payments WHERE tenant_id = $1 AND patient_id = $2',
            [tenant.id, patient.id]
        );
        expect(payment.rows).toHaveLength(1);
        expect(payment.rows[0].amount_cents).toBe(42000);
        expect(payment.rows[0].idempotency_key).toBe(`receipt_${receipt.id}`);

        const receiptRow = await pool.query('SELECT payment_id FROM psychotherapy_receipts WHERE id = $1', [receipt.id]);
        expect(receiptRow.rows[0].payment_id).toBe(payment.rows[0].id);
    });

    it('atualiza um recibo existente (via id) sem criar um segundo financial_payment', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);

        const receipt = await billingRepo.saveReceipt({
            tenantId: tenant.id, patientId: patient.id, amountCents: 10000,
            issueDate: new Date('2025-02-10'), description: 'Original',
        });

        const updated = await billingRepo.saveReceipt({
            id: receipt.id, tenantId: tenant.id, patientId: patient.id, amountCents: 20000,
            issueDate: new Date('2025-02-11'), description: 'Atualizado',
        });

        expect(updated.id).toBe(receipt.id);
        expect(updated.amountCents).toBe(20000);
        expect(updated.description).toBe('Atualizado');

        const payments = await pool.query('SELECT COUNT(*) FROM financial_payments WHERE tenant_id = $1', [tenant.id]);
        expect(Number(payments.rows[0].count)).toBe(1);
    });

    it('lança NotFoundError se o paciente não existir/não pertencer ao tenant', async () => {
        const tenant = await createTenant(pool);

        await expect(billingRepo.saveReceipt({
            tenantId: tenant.id, patientId: '00000000-0000-0000-0000-000000000000',
            amountCents: 10000, issueDate: new Date('2025-02-10'), description: 'Sem paciente',
        })).rejects.toThrow(NotFoundError);
    });
});

describe('PostgresBillingRepository.deleteReceipt', () => {
    it('apaga o recibo e estorna (não deleta fisicamente) o financial_payment vinculado', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const receipt = await billingRepo.saveReceipt({
            tenantId: tenant.id, patientId: patient.id, amountCents: 15000,
            issueDate: new Date('2025-02-10'), description: 'A apagar',
        });
        const paymentBefore = await pool.query('SELECT id FROM financial_payments WHERE tenant_id = $1', [tenant.id]);
        expect(paymentBefore.rows).toHaveLength(1);

        await billingRepo.deleteReceipt(tenant.id, receipt.id, tenant.id, 'Recibo emitido por engano');

        const receiptAfter = await pool.query('SELECT * FROM psychotherapy_receipts WHERE id = $1', [receipt.id]);
        expect(receiptAfter.rows).toHaveLength(0);

        // Ledger é append-only (trg_protect_financial_payments, migration 056) -- a linha
        // continua existindo, só marcada como voided, nunca fisicamente deletada.
        const paymentAfter = await pool.query('SELECT status, voided_by, void_reason FROM financial_payments WHERE id = $1', [paymentBefore.rows[0].id]);
        expect(paymentAfter.rows).toHaveLength(1);
        expect(paymentAfter.rows[0].status).toBe('voided');
        expect(paymentAfter.rows[0].voided_by).toBe(tenant.id);
        expect(paymentAfter.rows[0].void_reason).toBe('Recibo emitido por engano');
    });

    it('lança NotFoundError para recibo inexistente ou de outro tenant', async () => {
        const tenant = await createTenant(pool);
        const otherTenant = await createTenant(pool);
        const patient = await createPatient(pool, otherTenant.id);
        const receipt = await billingRepo.saveReceipt({
            tenantId: otherTenant.id, patientId: patient.id, amountCents: 10000,
            issueDate: new Date('2025-02-10'), description: 'De outro tenant',
        });

        await expect(billingRepo.deleteReceipt(tenant.id, receipt.id, tenant.id, 'Tentativa de outro tenant')).rejects.toThrow(NotFoundError);

        // Garante que o recibo do outro tenant não foi afetado pela tentativa.
        const stillThere = await pool.query('SELECT id FROM psychotherapy_receipts WHERE id = $1', [receipt.id]);
        expect(stillThere.rows).toHaveLength(1);
    });
});
