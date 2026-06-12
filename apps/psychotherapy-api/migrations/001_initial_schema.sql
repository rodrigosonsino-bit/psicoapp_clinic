-- Migration: 001_initial_schema.sql
-- Descrição: Schema inicial do psychotherapy-backend
-- Criado em: 2026-06-01

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Tabela de tenants ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    VARCHAR(255)    NOT NULL,
    email                   VARCHAR(255)    UNIQUE NOT NULL,
    password_hash           VARCHAR(255)    NOT NULL,
    plan                    VARCHAR(50)     NOT NULL DEFAULT 'starter',
    status                  VARCHAR(20)     NOT NULL DEFAULT 'trial',
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ── Pacientes ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS psychotherapy_patients (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID            NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name                        VARCHAR(255)    NOT NULL,
    status                      VARCHAR(20)     NOT NULL
                                    CHECK (status IN ('weekly', 'biweekly', 'one_off', 'inactive')),
    payment_type                VARCHAR(20)
                                    CHECK (payment_type IN ('monthly', 'per_session')),
    default_session_price_cents INT
                                    CHECK (default_session_price_cents IS NULL OR default_session_price_cents >= 0),
    notes                       TEXT,
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_psychotherapy_patients_tenant
    ON psychotherapy_patients(tenant_id, name);

-- ── Registros mensais ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS psychotherapy_monthly_records (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID            NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    patient_id                  UUID            REFERENCES psychotherapy_patients(id) ON DELETE SET NULL,
    month                       CHAR(7)         NOT NULL
                                    CHECK (month ~ '^\d{4}-\d{2}$'),
    patient_name_snapshot       VARCHAR(255)    NOT NULL,
    status                      VARCHAR(20)     NOT NULL
                                    CHECK (status IN ('weekly', 'biweekly', 'one_off', 'inactive')),
    payment_type                VARCHAR(20)
                                    CHECK (payment_type IN ('monthly', 'per_session')),
    session_price_cents         INT
                                    CHECK (session_price_cents IS NULL OR session_price_cents >= 0),
    expected_sessions           INT             NOT NULL DEFAULT 0 CHECK (expected_sessions >= 0),
    paid_sessions               INT             NOT NULL DEFAULT 0 CHECK (paid_sessions >= 0),
    absences                    INT             NOT NULL DEFAULT 0 CHECK (absences >= 0),
    payment_status              VARCHAR(20)     NOT NULL DEFAULT 'pending'
                                    CHECK (payment_status IN ('paid', 'pending', 'partial')),
    notes                       TEXT,
    previous_month_paid_cents   INT             NOT NULL DEFAULT 0 CHECK (previous_month_paid_cents >= 0),
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Um único registro por paciente por mês (quando patient_id não é nulo)
CREATE UNIQUE INDEX IF NOT EXISTS idx_psychotherapy_monthly_patient
    ON psychotherapy_monthly_records(tenant_id, month, patient_id)
    WHERE patient_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_psychotherapy_monthly_tenant_month
    ON psychotherapy_monthly_records(tenant_id, month);
