-- Migration: 101_add_meet_link_and_transcripts.sql (Down)
-- Descrição: Remove a tabela session_transcripts e a coluna google_meet_link

DROP TABLE IF EXISTS session_transcripts;

ALTER TABLE psychotherapy_appointments 
DROP COLUMN IF EXISTS google_meet_link;
