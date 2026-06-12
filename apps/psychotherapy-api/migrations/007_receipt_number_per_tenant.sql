-- Migration: 007_receipt_number_per_tenant.sql
-- Descrição: Torna receipt_number sequencial por tenant em vez de global e cria a tabela de sequenciadores

-- 0. Tabela de controle de sequências de recibos por tenant
CREATE TABLE IF NOT EXISTS tenant_receipt_sequences (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    last_value INT NOT NULL DEFAULT 0
);

-- 1. Remove o default gerado pelo SERIAL (a sequence associada)
ALTER TABLE psychotherapy_receipts
    ALTER COLUMN receipt_number DROP DEFAULT;

-- 2. Remove a sequence criada pelo SERIAL
DROP SEQUENCE IF EXISTS psychotherapy_receipts_receipt_number_seq;

-- 3. Garante NOT NULL
ALTER TABLE psychotherapy_receipts
    ALTER COLUMN receipt_number SET NOT NULL;

-- 4. Índice único por tenant (garante que dois recibos do mesmo tenant não tenham o mesmo número)
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_tenant_number
    ON psychotherapy_receipts(tenant_id, receipt_number);
