-- Migration: 022_group_payments.sql
-- Descrição: Adiciona faturamento por mensalidade a grupos terapêuticos e cria a tabela de pagamentos correspondente.
-- Criado em: 2026-06-08

-- 1. Novos campos em therapy_groups
ALTER TABLE therapy_groups
    ADD COLUMN IF NOT EXISTS monthly_fee_cents  INT CHECK (monthly_fee_cents >= 0),
    ADD COLUMN IF NOT EXISTS start_date         DATE,
    ADD COLUMN IF NOT EXISTS duration_months    SMALLINT CHECK (duration_months IS NULL OR duration_months > 0);

-- 2. Enum de método de pagamento
DO $$ BEGIN
    CREATE TYPE group_payment_method AS ENUM ('pix', 'cash', 'debit_card', 'credit_card');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. Tabela de pagamentos de grupo
CREATE TABLE IF NOT EXISTS group_payments (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    group_id             UUID NOT NULL REFERENCES therapy_groups(id) ON DELETE RESTRICT,
    patient_id           UUID NOT NULL REFERENCES psychotherapy_patients(id) ON DELETE RESTRICT,
    reference_month      TEXT NOT NULL,                  -- 'YYYY-MM'
    amount_cents         INT NOT NULL CHECK (amount_cents > 0),
    payment_method       group_payment_method NOT NULL DEFAULT 'pix',
    total_installments   INT NOT NULL DEFAULT 1 CHECK (total_installments >= 1),
    installment_number   INT NOT NULL DEFAULT 1 CHECK (installment_number >= 1 AND installment_number <= total_installments),
    installment_group_id UUID,                           -- agrupa parcelas do mesmo parcelamento
    paid_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes                TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_group_payment_installment
        UNIQUE (group_id, patient_id, reference_month, installment_number)
);

-- 4. Índices
CREATE INDEX IF NOT EXISTS idx_group_payments_group_month
    ON group_payments(group_id, reference_month);
CREATE INDEX IF NOT EXISTS idx_group_payments_patient
    ON group_payments(patient_id, reference_month);
CREATE INDEX IF NOT EXISTS idx_group_payments_tenant
    ON group_payments(tenant_id, reference_month);
CREATE INDEX IF NOT EXISTS idx_group_payments_installment_group
    ON group_payments(installment_group_id)
    WHERE installment_group_id IS NOT NULL;
