-- Migration: 004_expenses.sql
-- Descrição: Criação da tabela de despesas de psicoterapia de forma idempotente

CREATE TABLE IF NOT EXISTS psychotherapy_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    date TIMESTAMP WITH TIME ZONE NOT NULL,
    amount_cents INTEGER NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_psychotherapy_expenses_tenant_date ON psychotherapy_expenses(tenant_id, date);
