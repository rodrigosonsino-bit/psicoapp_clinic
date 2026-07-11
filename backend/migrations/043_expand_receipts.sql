-- Migration: 043_expand_receipts.sql
-- Descrição: Expansão de psychotherapy_receipts com snapshots imutáveis, controle de cancelamento, FK de pagamento e tabela de audit_logs.

-- 1. Adicionar colunas a psychotherapy_receipts
ALTER TABLE psychotherapy_receipts ADD COLUMN IF NOT EXISTS payment_id UUID;
ALTER TABLE psychotherapy_receipts ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'canceled'));
ALTER TABLE psychotherapy_receipts ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE psychotherapy_receipts ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ;
ALTER TABLE psychotherapy_receipts ADD COLUMN IF NOT EXISTS canceled_by UUID REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE psychotherapy_receipts ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE psychotherapy_receipts ADD COLUMN IF NOT EXISTS provider_name VARCHAR(255);
ALTER TABLE psychotherapy_receipts ADD COLUMN IF NOT EXISTS provider_document VARCHAR(255);
ALTER TABLE psychotherapy_receipts ADD COLUMN IF NOT EXISTS provider_professional_id VARCHAR(255);
ALTER TABLE psychotherapy_receipts ADD COLUMN IF NOT EXISTS provider_address TEXT;
ALTER TABLE psychotherapy_receipts ADD COLUMN IF NOT EXISTS beneficiary_name VARCHAR(255);
ALTER TABLE psychotherapy_receipts ADD COLUMN IF NOT EXISTS beneficiary_document VARCHAR(255);
ALTER TABLE psychotherapy_receipts ADD COLUMN IF NOT EXISTS responsible_name VARCHAR(255);
ALTER TABLE psychotherapy_receipts ADD COLUMN IF NOT EXISTS responsible_document VARCHAR(255);
ALTER TABLE psychotherapy_receipts ADD COLUMN IF NOT EXISTS payment_date TIMESTAMPTZ;
ALTER TABLE psychotherapy_receipts ADD COLUMN IF NOT EXISTS service_modality VARCHAR(100);
ALTER TABLE psychotherapy_receipts ADD COLUMN IF NOT EXISTS snapshot_version INTEGER DEFAULT 1;

-- 2. Atualizar registros existentes para legado
UPDATE psychotherapy_receipts
SET is_legacy = true,
    status = 'issued',
    payment_id = NULL
WHERE is_legacy = false;

-- 3. Adicionar FK composta para payment
ALTER TABLE psychotherapy_receipts ADD CONSTRAINT fk_receipt_payment_tenant 
  FOREIGN KEY (payment_id, tenant_id) REFERENCES financial_payments(id, tenant_id) ON DELETE RESTRICT;

-- 4. Tabela de auditoria append-only para mensagens e financeira
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  aggregate_type VARCHAR(100) NOT NULL,
  aggregate_id UUID NOT NULL,
  action VARCHAR(100) NOT NULL,
  operator_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  justification TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
