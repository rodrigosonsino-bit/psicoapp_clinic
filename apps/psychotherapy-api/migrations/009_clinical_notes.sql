-- Migration: 009_clinical_notes.sql
-- Descrição: Prontuário clínico por paciente, com suporte a tags e link opcional a sessão

CREATE TABLE IF NOT EXISTS psychotherapy_clinical_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES psychotherapy_patients(id) ON DELETE CASCADE,
    session_id UUID REFERENCES psychotherapy_sessions(id) ON DELETE SET NULL,
    note_date DATE NOT NULL,
    content TEXT NOT NULL,
    tags TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_clinical_notes_tenant ON psychotherapy_clinical_notes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_clinical_notes_patient ON psychotherapy_clinical_notes(patient_id);
CREATE INDEX IF NOT EXISTS idx_clinical_notes_date ON psychotherapy_clinical_notes(note_date DESC);
CREATE INDEX IF NOT EXISTS idx_clinical_notes_session ON psychotherapy_clinical_notes(session_id);
