-- Migration: 021_fixed_expenses.sql
-- Descrição: Criação da tabela de templates de despesas fixas e atualização da tabela de despesas

CREATE TABLE IF NOT EXISTS psychotherapy_fixed_expenses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    description     TEXT NOT NULL,
    amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
    day_of_month    INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 28),
    category        TEXT,
    start_date      DATE NOT NULL,
    end_date        DATE,
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fixed_expenses_tenant
    ON psychotherapy_fixed_expenses(tenant_id);

ALTER TABLE psychotherapy_expenses
ADD COLUMN IF NOT EXISTS fixed_expense_id UUID REFERENCES psychotherapy_fixed_expenses(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS reference_month  TEXT;
