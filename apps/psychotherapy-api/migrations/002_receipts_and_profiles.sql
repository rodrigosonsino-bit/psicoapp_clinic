-- Migration: 002_receipts_and_profiles.sql
-- Descrição: Criação da tabela de recibos e expansão do perfil do tenant/paciente
-- Criado em: 2026-06-02

-- 1. Expansão da tabela tenants (Perfil Profissional)
ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS full_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS document VARCHAR(20), -- CPF ou CNPJ
ADD COLUMN IF NOT EXISTS professional_id VARCHAR(50), -- CRP
ADD COLUMN IF NOT EXISTS address TEXT;

-- 2. Expansão da tabela de pacientes (CPF)
ALTER TABLE psychotherapy_patients
ADD COLUMN IF NOT EXISTS document VARCHAR(20); -- CPF

-- 3. Tabela de Recibos
CREATE TABLE IF NOT EXISTS psychotherapy_receipts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    patient_id      UUID NOT NULL REFERENCES psychotherapy_patients(id) ON DELETE CASCADE,
    receipt_number  SERIAL, -- Sequencial gerado automaticamente
    amount_cents    INT NOT NULL CHECK (amount_cents > 0),
    issue_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    description     TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices úteis para busca de recibos
CREATE INDEX IF NOT EXISTS idx_psychotherapy_receipts_tenant
    ON psychotherapy_receipts(tenant_id, issue_date);

CREATE INDEX IF NOT EXISTS idx_psychotherapy_receipts_patient
    ON psychotherapy_receipts(patient_id);
