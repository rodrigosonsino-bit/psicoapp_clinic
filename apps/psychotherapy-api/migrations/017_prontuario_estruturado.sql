-- Migration: 017_prontuario_estruturado.sql
-- Descrição: Prontuário estruturado — anamnese (1:1) e planos terapêuticos (1:N)

-- ── Anamnese ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS psychotherapy_anamnesis (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    patient_id           UUID NOT NULL REFERENCES psychotherapy_patients(id) ON DELETE CASCADE,

    -- Queixa principal e contexto
    chief_complaint      TEXT,
    onset_description    TEXT,           -- quando começou, o que desencadeou

    -- Histórico clínico
    previous_treatment   TEXT,           -- tratamentos anteriores
    medications          TEXT,           -- medicamentos em uso
    family_history       TEXT,
    relevant_history     TEXT,           -- saúde geral, traumas, marcos de vida

    -- Diagnóstico e abordagem (preenchível ao longo do processo)
    cid_codes            TEXT[] NOT NULL DEFAULT '{}',   -- ex: ['F33.1', 'Z73.1']
    therapeutic_approach TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (tenant_id, patient_id)       -- uma anamnese por paciente
);

CREATE INDEX IF NOT EXISTS idx_anamnesis_patient_id ON psychotherapy_anamnesis(patient_id);
CREATE INDEX IF NOT EXISTS idx_anamnesis_tenant_id  ON psychotherapy_anamnesis(tenant_id);

-- ── Planos Terapêuticos ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS psychotherapy_treatment_plans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    patient_id      UUID NOT NULL REFERENCES psychotherapy_patients(id) ON DELETE CASCADE,

    title           VARCHAR(200) NOT NULL,
    goals           TEXT[] NOT NULL DEFAULT '{}',       -- lista de objetivos terapêuticos
    approach        TEXT,
    target_sessions INTEGER,                            -- meta de sessões do ciclo
    status          VARCHAR(20) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'completed', 'suspended')),
    started_at      DATE NOT NULL DEFAULT CURRENT_DATE,
    ended_at        DATE,                               -- preenchido ao encerrar/suspender
    notes           TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_treatment_plans_patient_status
    ON psychotherapy_treatment_plans(patient_id, status);
CREATE INDEX IF NOT EXISTS idx_treatment_plans_tenant_id
    ON psychotherapy_treatment_plans(tenant_id);
