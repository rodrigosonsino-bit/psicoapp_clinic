-- migrate:transaction=false
-- Migration: 105b_transcription_v4_indexes.sql
-- Descrição: Índice concorrente para isolar criação de rascunhos sem causar downtime

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_clinical_notes_draft_tenant_appt 
ON psychotherapy_clinical_notes (tenant_id, appointment_id) 
WHERE status = 'draft';
