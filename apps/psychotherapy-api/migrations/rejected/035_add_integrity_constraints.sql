-- Migration: 035_add_integrity_constraints.sql
-- Descrição: Aplicação de constraints compostas, calendar_events, 2FA challenges e failed TOTP attempts.

-- 1. Criação das chaves únicas candidatas a partir dos índices existentes
ALTER TABLE psychotherapy_patients ADD CONSTRAINT uq_psychotherapy_patient_tenant UNIQUE USING INDEX uq_patients_idx;
ALTER TABLE psychotherapy_sessions ADD CONSTRAINT uq_session_tenant UNIQUE USING INDEX uq_sessions_idx;
ALTER TABLE psychotherapy_monthly_records ADD CONSTRAINT uq_monthly_record_tenant UNIQUE USING INDEX uq_monthly_records_idx;
ALTER TABLE psychotherapy_appointments ADD CONSTRAINT uq_appointment_tenant UNIQUE USING INDEX uq_appointments_idx;
ALTER TABLE therapy_groups ADD CONSTRAINT uq_group_tenant UNIQUE USING INDEX uq_groups_idx;

-- 2. Adiciona coluna deleted_at na tabela de pacientes
ALTER TABLE psychotherapy_patients ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 3. Criação da função imutável de limpeza de documento para o índice parcial
CREATE OR REPLACE FUNCTION clean_document_immutable(doc text)
RETURNS text AS $$
BEGIN
  IF doc IS NULL THEN
    RETURN '';
  END IF;
  RETURN regexp_replace(doc, '[^0-9]', '', 'g');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 4. Criação da tabela calendar_events com ended_at para indexação GiST imutável
CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  event_type TEXT NOT NULL CHECK (event_type IN ('individual', 'group')),
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'confirmed', 'completed', 'canceled')),
  group_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, tenant_id),
  CHECK (ended_at > scheduled_at),
  CHECK (
    (event_type = 'individual' AND group_id IS NULL) OR
    (event_type = 'group' AND group_id IS NOT NULL)
  ),
  FOREIGN KEY (group_id, tenant_id) REFERENCES therapy_groups(id, tenant_id) ON DELETE RESTRICT
);

-- Habilita btree_gist e cria a exclusão mútua concorrente física
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE calendar_events
ADD CONSTRAINT no_overlapping_active_events
EXCLUDE USING gist (
  tenant_id WITH =,
  tstzrange(scheduled_at, ended_at, '[)') WITH &&
)
WHERE (status IN ('scheduled', 'confirmed'));

-- 5. Criação da tabela two_factor_challenges e failed_totp_attempts
CREATE TABLE IF NOT EXISTS two_factor_challenges (
  challenge_hash CHAR(64) PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_2fa_challenge_expiry
  ON two_factor_challenges(expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS failed_totp_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ip_address INET NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_failed_totp_attempts_tenant_time
  ON failed_totp_attempts(tenant_id, attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_failed_totp_attempts_ip_time
  ON failed_totp_attempts(ip_address, attempted_at DESC);

-- 6. Rollout de therapy_group_members
ALTER TABLE therapy_group_members ADD COLUMN IF NOT EXISTS tenant_id UUID;

-- Backfill do tenant_id
UPDATE therapy_group_members m
SET tenant_id = g.tenant_id
FROM therapy_groups g
WHERE m.group_id = g.id AND m.tenant_id IS NULL;

-- Validação de integridade do backfill (abortar se houver inconsistências cross-tenant)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM therapy_group_members gm
    JOIN therapy_groups g ON gm.group_id = g.id
    JOIN psychotherapy_patients p ON gm.patient_id = p.id
    WHERE g.tenant_id <> p.tenant_id
  ) THEN
    RAISE EXCEPTION 'Inconsistência cross-tenant detectada em therapy_group_members.';
  END IF;
END $$;

ALTER TABLE therapy_group_members ALTER COLUMN tenant_id SET NOT NULL;

-- Remove FKs simples antigas
ALTER TABLE therapy_group_members DROP CONSTRAINT IF EXISTS therapy_group_members_group_id_fkey;
ALTER TABLE therapy_group_members DROP CONSTRAINT IF EXISTS therapy_group_members_patient_id_fkey;
ALTER TABLE therapy_group_members DROP CONSTRAINT IF EXISTS therapy_group_members_group_id_patient_id_key;

-- Adiciona novas constraints compostas
ALTER TABLE therapy_group_members ADD CONSTRAINT fk_group_members_group
  FOREIGN KEY (group_id, tenant_id) REFERENCES therapy_groups(id, tenant_id) ON DELETE RESTRICT;

ALTER TABLE therapy_group_members ADD CONSTRAINT fk_group_members_patient
  FOREIGN KEY (patient_id, tenant_id) REFERENCES psychotherapy_patients(id, tenant_id) ON DELETE RESTRICT;

ALTER TABLE therapy_group_members ADD CONSTRAINT uq_group_members_group_patient
  UNIQUE (group_id, patient_id, tenant_id);

-- 7. Rollout de calendar_event_id em psychotherapy_appointments
ALTER TABLE psychotherapy_appointments ADD COLUMN IF NOT EXISTS calendar_event_id UUID;

-- Backfill dos eventos canônicos para agendamentos individuais
INSERT INTO calendar_events (id, tenant_id, scheduled_at, ended_at, duration_minutes, event_type, status, group_id)
SELECT id, tenant_id, scheduled_at, scheduled_at + duration_minutes * interval '1 minute', duration_minutes, 'individual', status, NULL
FROM psychotherapy_appointments
WHERE group_id IS NULL;

-- Backfill dos eventos canônicos para agendamentos de grupo (agrupando por grupo, data/hora e duração)
INSERT INTO calendar_events (id, tenant_id, scheduled_at, ended_at, duration_minutes, event_type, status, group_id)
SELECT gen_random_uuid(), tenant_id, scheduled_at, scheduled_at + duration_minutes * interval '1 minute', duration_minutes, 'group', 'scheduled', group_id
FROM (
  SELECT DISTINCT tenant_id, scheduled_at, duration_minutes, group_id
  FROM psychotherapy_appointments
  WHERE group_id IS NOT NULL
) g_ev;

-- Atualizar o calendar_event_id nos appointments individuais
UPDATE psychotherapy_appointments a
SET calendar_event_id = a.id
WHERE a.group_id IS NULL AND a.calendar_event_id IS NULL;

-- Atualizar o calendar_event_id nos appointments de grupo
UPDATE psychotherapy_appointments a
SET calendar_event_id = c.id
FROM calendar_events c
WHERE a.group_id IS NOT NULL 
  AND a.calendar_event_id IS NULL
  AND a.group_id = c.group_id
  AND a.scheduled_at = c.scheduled_at
  AND a.duration_minutes = c.duration_minutes;

-- Garante que nenhum appointment ficou sem calendar_event_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM psychotherapy_appointments WHERE calendar_event_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Falha no backfill do calendar_event_id em psychotherapy_appointments.';
  END IF;
END $$;

ALTER TABLE psychotherapy_appointments ALTER COLUMN calendar_event_id SET NOT NULL;

-- 8. Substituição integral das FKs de pacientes e tabelas filhas para chaves compostas
-- Sessions
ALTER TABLE psychotherapy_sessions DROP CONSTRAINT IF EXISTS psychotherapy_sessions_patient_id_fkey;
ALTER TABLE psychotherapy_sessions ADD CONSTRAINT fk_sessions_patient_tenant
  FOREIGN KEY (patient_id, tenant_id) REFERENCES psychotherapy_patients(id, tenant_id) ON DELETE RESTRICT;

-- Receipts
ALTER TABLE psychotherapy_receipts DROP CONSTRAINT IF EXISTS psychotherapy_receipts_patient_id_fkey;
ALTER TABLE psychotherapy_receipts ADD CONSTRAINT fk_receipts_patient_tenant
  FOREIGN KEY (patient_id, tenant_id) REFERENCES psychotherapy_patients(id, tenant_id) ON DELETE RESTRICT;

-- Appointments
ALTER TABLE psychotherapy_appointments DROP CONSTRAINT IF EXISTS psychotherapy_appointments_patient_id_fkey;
ALTER TABLE psychotherapy_appointments ADD CONSTRAINT fk_appointments_patient_tenant
  FOREIGN KEY (patient_id, tenant_id) REFERENCES psychotherapy_patients(id, tenant_id) ON DELETE RESTRICT;

ALTER TABLE psychotherapy_appointments DROP CONSTRAINT IF EXISTS psychotherapy_appointments_group_id_fkey;
ALTER TABLE psychotherapy_appointments ADD CONSTRAINT fk_appointments_group_tenant
  FOREIGN KEY (group_id, tenant_id) REFERENCES therapy_groups(id, tenant_id) ON DELETE RESTRICT;

ALTER TABLE psychotherapy_appointments ADD CONSTRAINT fk_appointments_calendar_event
  FOREIGN KEY (calendar_event_id, tenant_id) REFERENCES calendar_events(id, tenant_id) ON DELETE RESTRICT;

ALTER TABLE psychotherapy_appointments DROP CONSTRAINT IF EXISTS psychotherapy_appointments_parent_id_fkey;
ALTER TABLE psychotherapy_appointments ADD CONSTRAINT fk_appointments_parent_tenant
  FOREIGN KEY (parent_id, tenant_id) REFERENCES psychotherapy_appointments(id, tenant_id) ON DELETE RESTRICT;

-- Clinical Notes
ALTER TABLE psychotherapy_clinical_notes DROP CONSTRAINT IF EXISTS psychotherapy_clinical_notes_patient_id_fkey;
ALTER TABLE psychotherapy_clinical_notes ADD CONSTRAINT fk_clinical_notes_patient_tenant
  FOREIGN KEY (patient_id, tenant_id) REFERENCES psychotherapy_patients(id, tenant_id) ON DELETE RESTRICT;

-- Pix Charges
ALTER TABLE psychotherapy_pix_charges DROP CONSTRAINT IF EXISTS psychotherapy_pix_charges_patient_id_fkey;
ALTER TABLE psychotherapy_pix_charges ADD CONSTRAINT fk_pix_charges_patient_tenant
  FOREIGN KEY (patient_id, tenant_id) REFERENCES psychotherapy_patients(id, tenant_id) ON DELETE RESTRICT;

-- Monthly Records
ALTER TABLE psychotherapy_monthly_records DROP CONSTRAINT IF EXISTS psychotherapy_monthly_records_patient_id_fkey;
ALTER TABLE psychotherapy_monthly_records ADD CONSTRAINT fk_monthly_records_patient_tenant
  FOREIGN KEY (patient_id, tenant_id) REFERENCES psychotherapy_patients(id, tenant_id) ON DELETE RESTRICT;

-- Anamnesis
ALTER TABLE psychotherapy_anamnesis DROP CONSTRAINT IF EXISTS psychotherapy_anamnesis_patient_id_fkey;
ALTER TABLE psychotherapy_anamnesis ADD CONSTRAINT fk_anamnesis_patient_tenant
  FOREIGN KEY (patient_id, tenant_id) REFERENCES psychotherapy_patients(id, tenant_id) ON DELETE RESTRICT;

-- Treatment Plans
ALTER TABLE psychotherapy_treatment_plans DROP CONSTRAINT IF EXISTS psychotherapy_treatment_plans_patient_id_fkey;
ALTER TABLE psychotherapy_treatment_plans ADD CONSTRAINT fk_treatment_plans_patient_tenant
  FOREIGN KEY (patient_id, tenant_id) REFERENCES psychotherapy_patients(id, tenant_id) ON DELETE RESTRICT;

-- Group Payments
ALTER TABLE group_payments DROP CONSTRAINT IF EXISTS group_payments_patient_id_fkey;
ALTER TABLE group_payments ADD CONSTRAINT fk_group_payments_patient_tenant
  FOREIGN KEY (patient_id, tenant_id) REFERENCES psychotherapy_patients(id, tenant_id) ON DELETE RESTRICT;

ALTER TABLE group_payments DROP CONSTRAINT IF EXISTS group_payments_group_id_fkey;
ALTER TABLE group_payments ADD CONSTRAINT fk_group_payments_group_tenant
  FOREIGN KEY (group_id, tenant_id) REFERENCES therapy_groups(id, tenant_id) ON DELETE RESTRICT;

-- Group Session Records
ALTER TABLE group_session_records DROP CONSTRAINT IF EXISTS group_session_records_patient_id_fkey;
ALTER TABLE group_session_records ADD CONSTRAINT fk_group_session_records_patient_tenant
  FOREIGN KEY (patient_id, tenant_id) REFERENCES psychotherapy_patients(id, tenant_id) ON DELETE RESTRICT;

ALTER TABLE group_session_records DROP CONSTRAINT IF EXISTS group_session_records_group_id_fkey;
ALTER TABLE group_session_records ADD CONSTRAINT fk_group_session_records_group_tenant
  FOREIGN KEY (group_id, tenant_id) REFERENCES therapy_groups(id, tenant_id) ON DELETE RESTRICT;

ALTER TABLE group_session_records DROP CONSTRAINT IF EXISTS group_session_records_appointment_id_fkey;
ALTER TABLE group_session_records ADD CONSTRAINT fk_group_session_records_appointment_tenant
  FOREIGN KEY (appointment_id, tenant_id) REFERENCES psychotherapy_appointments(id, tenant_id) ON DELETE RESTRICT;

-- Booking Links
ALTER TABLE psychotherapy_booking_links DROP CONSTRAINT IF EXISTS psychotherapy_booking_links_patient_id_fkey;
ALTER TABLE psychotherapy_booking_links ADD CONSTRAINT fk_booking_links_patient_tenant
  FOREIGN KEY (patient_id, tenant_id) REFERENCES psychotherapy_patients(id, tenant_id) ON DELETE RESTRICT;

ALTER TABLE psychotherapy_booking_links DROP CONSTRAINT IF EXISTS psychotherapy_booking_links_tenant_id_fkey;
ALTER TABLE psychotherapy_booking_links ADD CONSTRAINT fk_booking_links_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

-- Reminders Log
ALTER TABLE psychotherapy_reminders_log DROP CONSTRAINT IF EXISTS psychotherapy_reminders_log_appointment_id_fkey;
ALTER TABLE psychotherapy_reminders_log ADD CONSTRAINT fk_reminders_log_appointment_tenant
  FOREIGN KEY (appointment_id, tenant_id) REFERENCES psychotherapy_appointments(id, tenant_id) ON DELETE RESTRICT;
