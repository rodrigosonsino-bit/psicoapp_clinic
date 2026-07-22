-- Migration: 101_add_meet_link_and_transcripts.sql (Up)
-- Descrição: Adiciona coluna de google_meet_link em psychotherapy_appointments e cria a tabela session_transcripts

ALTER TABLE psychotherapy_appointments 
ADD COLUMN IF NOT EXISTS google_meet_link VARCHAR(1024);

CREATE TABLE IF NOT EXISTS session_transcripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    session_id UUID NOT NULL REFERENCES psychotherapy_sessions(id) ON DELETE CASCADE,
    raw_transcript TEXT NOT NULL,
    summary_draft TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_session_transcript UNIQUE (tenant_id, session_id)
);
