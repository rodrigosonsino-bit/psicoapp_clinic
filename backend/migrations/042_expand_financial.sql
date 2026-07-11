-- Migration: 042_expand_financial.sql
-- Descrição: Criação das chaves únicas candidatas, tabelas do ledger financeiro, cutovers, snapshots legados e campos de suporte.

-- 1. Criação das chaves únicas candidatas a partir dos índices existentes
ALTER TABLE psychotherapy_patients ADD CONSTRAINT uq_psychotherapy_patient_tenant UNIQUE USING INDEX uq_patients_idx;
ALTER TABLE psychotherapy_monthly_records ADD CONSTRAINT uq_monthly_record_tenant UNIQUE USING INDEX uq_monthly_records_idx;

-- 2. Tabela financial_payments
CREATE TABLE IF NOT EXISTS financial_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  patient_id UUID NOT NULL,
  monthly_record_id UUID,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency CHAR(3) NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  paid_at TIMESTAMPTZ NOT NULL,
  method VARCHAR(50) NOT NULL CHECK (method IN ('pix', 'credit_card', 'cash', 'bank_transfer', 'other')),
  source VARCHAR(50) NOT NULL CHECK (source IN ('manual', 'pix')),
  status VARCHAR(50) NOT NULL CHECK (status IN ('confirmed', 'voided')),
  provider_txid VARCHAR(100),
  idempotency_key VARCHAR(100) NOT NULL,
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES tenants(id) ON DELETE RESTRICT,
  void_reason TEXT,
  created_by UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT chk_voided_consistency CHECK (
    (status = 'confirmed' AND voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL) OR
    (status = 'voided' AND voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL)
  ),
  FOREIGN KEY (patient_id, tenant_id) REFERENCES psychotherapy_patients(id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (monthly_record_id, tenant_id) REFERENCES psychotherapy_monthly_records(id, tenant_id) ON DELETE RESTRICT
);

-- 3. Adiciona campo expected_amount_cents a psychotherapy_monthly_records
ALTER TABLE psychotherapy_monthly_records ADD COLUMN IF NOT EXISTS expected_amount_cents INTEGER CHECK (expected_amount_cents >= 0);

-- 4. Tabela tenant_financial_cutovers
CREATE TABLE IF NOT EXISTS tenant_financial_cutovers (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  cutover_at TIMESTAMPTZ,
  status VARCHAR(50) NOT NULL CHECK (status IN ('draft', 'approved')),
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES tenants(id) ON DELETE RESTRICT
);

-- 5. Tabela legacy_financial_snapshots
CREATE TABLE IF NOT EXISTS legacy_financial_snapshots (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  patient_id UUID NOT NULL,
  month VARCHAR(7) NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  paid_sessions INTEGER NOT NULL CHECK (paid_sessions >= 0),
  source_formula_version VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL CHECK (status IN ('pending_review', 'approved')),
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES tenants(id) ON DELETE RESTRICT,
  PRIMARY KEY (tenant_id, patient_id, month),
  FOREIGN KEY (patient_id, tenant_id) REFERENCES psychotherapy_patients(id, tenant_id) ON DELETE RESTRICT
);
