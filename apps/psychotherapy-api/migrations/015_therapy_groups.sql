-- Migration: 015_therapy_groups.sql
-- Descrição: Criação das tabelas de grupos de terapia e seus membros, e relacionamento com agendamentos.
-- Criado em: 2026-06-06

-- ── Tabela de Grupos de Terapia ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS therapy_groups (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name                    TEXT NOT NULL,
    description             TEXT,
    session_price_cents     INT NOT NULL DEFAULT 10000 CHECK (session_price_cents >= 0),
    day_of_week             SMALLINT CHECK (day_of_week >= 0 AND day_of_week <= 6),
    start_time              TIME,
    duration_minutes        INT NOT NULL DEFAULT 90 CHECK (duration_minutes > 0),
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexadores para buscas rápidas de grupos por tenant
CREATE INDEX IF NOT EXISTS idx_therapy_groups_tenant ON therapy_groups(tenant_id);

-- ── Tabela de Membros do Grupo ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS therapy_group_members (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id                UUID NOT NULL REFERENCES therapy_groups(id) ON DELETE CASCADE,
    patient_id              UUID NOT NULL REFERENCES psychotherapy_patients(id) ON DELETE CASCADE,
    joined_at               DATE NOT NULL DEFAULT CURRENT_DATE,
    left_at                 DATE CHECK (left_at IS NULL OR left_at >= joined_at),
    UNIQUE(group_id, patient_id)
);

-- Indexadores para buscas rápidas de membros
CREATE INDEX IF NOT EXISTS idx_therapy_group_members_group ON therapy_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_therapy_group_members_patient ON therapy_group_members(patient_id);

-- ── Vinculação opcional com a Tabela de Agendamentos ────────────────────────
ALTER TABLE psychotherapy_appointments
    ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES therapy_groups(id) ON DELETE SET NULL;

-- Indexador para buscas de agendamentos associados a um grupo
CREATE INDEX IF NOT EXISTS idx_appointments_group ON psychotherapy_appointments(group_id);
