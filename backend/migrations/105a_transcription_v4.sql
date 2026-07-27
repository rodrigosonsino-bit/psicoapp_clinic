-- Migration: 105a_transcription_v4.sql
-- Descrição: Alterações estruturais para suportar fluxo de transcrição híbrida, com FKs multitenant e versão otimista.

-- 1. Preferência do tenant
ALTER TABLE tenants 
ADD COLUMN transcription_preference VARCHAR(50) NOT NULL DEFAULT 'deepgram_web' 
CHECK (transcription_preference IN ('deepgram_web', 'google_meet_native'));

-- 2. Intent no OAuth
ALTER TABLE google_oauth_states 
ADD COLUMN intent VARCHAR(50) NOT NULL DEFAULT 'calendar' 
CHECK (intent IN ('calendar', 'meet_transcription'));

-- 3. Campos em notas clínicas
ALTER TABLE psychotherapy_clinical_notes 
ADD COLUMN appointment_id UUID;

ALTER TABLE psychotherapy_clinical_notes 
ADD COLUMN status VARCHAR(50) NOT NULL DEFAULT 'final' 
CHECK (status IN ('draft', 'final'));

ALTER TABLE psychotherapy_clinical_notes 
ADD COLUMN source VARCHAR(50) NOT NULL DEFAULT 'manual' 
CHECK (source IN ('manual', 'meet_transcript', 'deepgram'));

ALTER TABLE psychotherapy_clinical_notes 
ADD COLUMN version BIGINT NOT NULL DEFAULT 1;

-- UNIQUE composto para FK segura e para index parcial (criado no 105b)
ALTER TABLE psychotherapy_clinical_notes 
ADD CONSTRAINT uq_notes_tenant_id UNIQUE (id, tenant_id);

ALTER TABLE psychotherapy_appointments 
ADD CONSTRAINT uq_appointments_tenant_id UNIQUE (id, tenant_id);

-- FK isolada apenas no UUID para permitir ON DELETE SET NULL em apenas uma coluna
ALTER TABLE psychotherapy_clinical_notes 
ADD CONSTRAINT fk_notes_appointment FOREIGN KEY (appointment_id) 
REFERENCES psychotherapy_appointments(id) ON DELETE SET NULL NOT VALID;

-- 4. Fencing token em jobs
ALTER TABLE transcription_jobs 
ADD COLUMN lease_token UUID;

ALTER TABLE transcription_jobs 
ADD CONSTRAINT fk_draft_note FOREIGN KEY (draft_note_id) 
REFERENCES psychotherapy_clinical_notes(id) ON DELETE SET NULL NOT VALID;

-- Validação postergada (reduz lock em prod)
-- ALTER TABLE psychotherapy_clinical_notes VALIDATE CONSTRAINT fk_notes_appointment;
-- ALTER TABLE transcription_jobs VALIDATE CONSTRAINT fk_draft_note;
