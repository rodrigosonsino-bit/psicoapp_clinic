-- Migration: 003_sessions.sql
-- Descrição: Criação da tabela de sessões de psicoterapia com chaves estrangeiras corretas e idempotência

DO $$ BEGIN
    CREATE TYPE session_status AS ENUM ('attended', 'justified_absence', 'unjustified_absence', 'canceled');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS psychotherapy_sessions (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES psychotherapy_patients(id) ON DELETE CASCADE,
    date TIMESTAMP NOT NULL,
    status session_status NOT NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_tenant ON psychotherapy_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_patient ON psychotherapy_sessions(patient_id);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON psychotherapy_sessions(date);
