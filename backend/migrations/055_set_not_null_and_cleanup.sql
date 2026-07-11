-- Migration: 055_set_not_null_and_cleanup.sql
-- Descrição: Ajuste de colunas físicas para NOT NULL, remoção de CHECKs temporários e de FKs antigas de chave simples.

-- 1. Definição física de NOT NULL para colunas migradas
ALTER TABLE psychotherapy_appointments ALTER COLUMN calendar_event_id SET NOT NULL;
ALTER TABLE therapy_group_members ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE auth_refresh_tokens ALTER COLUMN family_id SET NOT NULL;

-- 2. Remoção dos CHECKs auxiliares
ALTER TABLE psychotherapy_appointments DROP CONSTRAINT IF EXISTS chk_calendar_event_id_not_null;
ALTER TABLE therapy_group_members DROP CONSTRAINT IF EXISTS chk_group_members_tenant_id_not_null;
ALTER TABLE auth_refresh_tokens DROP CONSTRAINT IF EXISTS chk_refresh_tokens_family_id_not_null;

-- 3. Remoção das FKs antigas de chave simples
ALTER TABLE psychotherapy_sessions DROP CONSTRAINT IF EXISTS psychotherapy_sessions_patient_id_fkey;
ALTER TABLE psychotherapy_receipts DROP CONSTRAINT IF EXISTS psychotherapy_receipts_patient_id_fkey;
ALTER TABLE psychotherapy_appointments DROP CONSTRAINT IF EXISTS psychotherapy_appointments_patient_id_fkey;
ALTER TABLE psychotherapy_appointments DROP CONSTRAINT IF EXISTS psychotherapy_appointments_parent_id_fkey;
ALTER TABLE psychotherapy_clinical_notes DROP CONSTRAINT IF EXISTS psychotherapy_clinical_notes_patient_id_fkey;
ALTER TABLE psychotherapy_clinical_notes DROP CONSTRAINT IF EXISTS psychotherapy_clinical_notes_session_id_fkey;
ALTER TABLE psychotherapy_pix_charges DROP CONSTRAINT IF EXISTS psychotherapy_pix_charges_patient_id_fkey;
ALTER TABLE psychotherapy_monthly_records DROP CONSTRAINT IF EXISTS psychotherapy_monthly_records_patient_id_fkey;
ALTER TABLE therapy_group_members DROP CONSTRAINT IF EXISTS therapy_group_members_patient_id_fkey;
ALTER TABLE therapy_group_members DROP CONSTRAINT IF EXISTS therapy_group_members_group_id_fkey;
