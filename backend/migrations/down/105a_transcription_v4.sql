-- Migration: down/105a_transcription_v4.sql

-- PREFLIGHT: Bloqueia a execução se existirem notas em estado 'draft', para prevenir perda de dados.
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM psychotherapy_clinical_notes WHERE status = 'draft') THEN
        RAISE EXCEPTION 'Existem notas clínicas em rascunho (status = "draft"). O rollback desta migration causará perda de dados não oficializados. Abortando.';
    END IF;
END $$;

-- Remove FKs em transcription_jobs
ALTER TABLE transcription_jobs DROP CONSTRAINT IF EXISTS fk_draft_note;
ALTER TABLE transcription_jobs DROP COLUMN IF EXISTS lease_token;

-- Remove FKs em psychotherapy_clinical_notes
ALTER TABLE psychotherapy_clinical_notes DROP CONSTRAINT IF EXISTS fk_notes_appointment;
ALTER TABLE psychotherapy_clinical_notes DROP CONSTRAINT IF EXISTS uq_notes_tenant_id;

-- Remove uq_appointments_tenant_id de psychotherapy_appointments (se existir)
ALTER TABLE psychotherapy_appointments DROP CONSTRAINT IF EXISTS uq_appointments_tenant_id;

-- Remove colunas de notas clínicas
ALTER TABLE psychotherapy_clinical_notes DROP COLUMN IF EXISTS appointment_id;
ALTER TABLE psychotherapy_clinical_notes DROP COLUMN IF EXISTS status;
ALTER TABLE psychotherapy_clinical_notes DROP COLUMN IF EXISTS source;
ALTER TABLE psychotherapy_clinical_notes DROP COLUMN IF EXISTS version;

-- Remove intent do OAuth
ALTER TABLE google_oauth_states DROP COLUMN IF EXISTS intent;

-- Remove preference do tenant
ALTER TABLE tenants DROP COLUMN IF EXISTS transcription_preference;
