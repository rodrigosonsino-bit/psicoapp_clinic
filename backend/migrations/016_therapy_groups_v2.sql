-- ══════════════════════════════════════════════════════════════════════════════
-- Migration: 016_therapy_groups_v2.sql
-- Fase 1 — Banco de Dados: Correções e extensões ao esquema de grupos de terapia
--
-- Incorpora todas as decisões de design da revisão:
--   ✅ Soft delete no therapy_groups (is_active já existe, adicionar deleted_at)
--   ✅ Mudar ON DELETE CASCADE → ON DELETE SET NULL em appointments.group_id
--      (preservar histórico clínico e financeiro)
--   ✅ Enum group_session_attendance_status para controle de presença
--   ✅ Tabela group_session_records para registro de sessões de grupo
--   ✅ Restrição de idempotência: (group_id, session_date, patient_id)
--   ✅ Índices de performance para queries do frontend
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Soft delete: adicionar deleted_at ao therapy_groups ───────────────────
-- is_active já foi criado na 015. Apenas garantimos deleted_at para auditoria.
ALTER TABLE therapy_groups
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- ── 2. Corrigir FK de appointments.group_id: CASCADE → SET NULL ──────────────
-- ON DELETE CASCADE apagaria registros clínicos ao deletar um grupo.
-- SET NULL preserva o histórico; o grupo pode ser soft-deleted via is_active.
DO $$
BEGIN
    -- Remover a FK antiga (ON DELETE SET NULL já era o valor da 015, confirmar)
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'psychotherapy_appointments_group_id_fkey'
          AND table_name = 'psychotherapy_appointments'
    ) THEN
        ALTER TABLE psychotherapy_appointments
            DROP CONSTRAINT psychotherapy_appointments_group_id_fkey;
    END IF;

    -- Recriar com ON DELETE SET NULL explícito
    ALTER TABLE psychotherapy_appointments
        ADD CONSTRAINT psychotherapy_appointments_group_id_fkey
        FOREIGN KEY (group_id)
        REFERENCES therapy_groups(id)
        ON DELETE SET NULL;
END $$;

-- ── 3. Enum de status de presença em sessão de grupo ────────────────────────
DO $$ BEGIN
    CREATE TYPE group_attendance_status AS ENUM ('present', 'absent', 'excused');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ── 4. Tabela de registros de sessões de grupo ───────────────────────────────
-- Cada linha = presença/falta de um paciente em uma sessão coletiva específica.
-- Vincula automaticamente ao psychotherapy_appointments de cada paciente.
CREATE TABLE IF NOT EXISTS group_session_records (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    group_id            UUID NOT NULL REFERENCES therapy_groups(id) ON DELETE RESTRICT,
    -- Data da sessão (sem hora — hora fica no grupo ou no appointment)
    session_date        DATE NOT NULL,
    patient_id          UUID NOT NULL REFERENCES psychotherapy_patients(id) ON DELETE RESTRICT,
    -- Appointment individual gerado para este paciente nesta sessão
    appointment_id      UUID REFERENCES psychotherapy_appointments(id) ON DELETE SET NULL,
    attendance_status   group_attendance_status NOT NULL DEFAULT 'present',
    notes               TEXT,
    -- Valor cobrado nesta sessão (pode diferir do padrão do grupo por exceção)
    session_price_cents INT CHECK (session_price_cents >= 0),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- ── Idempotência: impede duplicidade de registro por paciente/sessão/grupo
    CONSTRAINT uq_group_session_patient
        UNIQUE (group_id, session_date, patient_id)
);

COMMENT ON TABLE group_session_records IS
    'Registro de presença/falta por paciente em cada sessão de grupo. '
    'Uma linha por (grupo, data, paciente). Vinculada ao appointment individual.';

COMMENT ON COLUMN group_session_records.session_price_cents IS
    'Preço cobrado nesta sessão específica. NULL = usar session_price_cents do therapy_groups.';

-- ── 5. Índices de performance ────────────────────────────────────────────────

-- Buscar todas as sessões de um grupo (ex: histórico do grupo)
CREATE INDEX IF NOT EXISTS idx_group_session_records_group_date
    ON group_session_records(group_id, session_date DESC);

-- Buscar todas as sessões de um paciente (ex: tela do paciente)
CREATE INDEX IF NOT EXISTS idx_group_session_records_patient
    ON group_session_records(patient_id);

-- Buscar por tenant + mês (ex: relatório mensal)
CREATE INDEX IF NOT EXISTS idx_group_session_records_tenant_date
    ON group_session_records(tenant_id, session_date);

-- Buscar registros vinculados a um appointment
CREATE INDEX IF NOT EXISTS idx_group_session_records_appointment
    ON group_session_records(appointment_id);

-- Índice parcial: grupos ativos (usados nas telas de gestão)
CREATE INDEX IF NOT EXISTS idx_therapy_groups_tenant_active
    ON therapy_groups(tenant_id)
    WHERE is_active = TRUE AND deleted_at IS NULL;

-- ── 6. Trigger: atualizar updated_at automaticamente ────────────────────────
-- Reusa a função update_updated_at_column se já existir no banco.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column'
    ) THEN
        EXECUTE $func$
            CREATE OR REPLACE FUNCTION update_updated_at_column()
            RETURNS TRIGGER AS $trig$
            BEGIN
                NEW.updated_at = NOW();
                RETURN NEW;
            END;
            $trig$ LANGUAGE plpgsql;
        $func$;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_group_session_records_updated_at'
    ) THEN
        CREATE TRIGGER trg_group_session_records_updated_at
            BEFORE UPDATE ON group_session_records
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO FINAL (comentada — para rodar manualmente em dev/staging):
--
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'group_session_records'
-- ORDER BY ordinal_position;
--
-- SELECT conname, confdeltype
-- FROM pg_constraint
-- WHERE conrelid = 'psychotherapy_appointments'::regclass
--   AND conname = 'psychotherapy_appointments_group_id_fkey';
-- (confdeltype deve ser 'a' = SET NULL)
-- ══════════════════════════════════════════════════════════════════════════════
