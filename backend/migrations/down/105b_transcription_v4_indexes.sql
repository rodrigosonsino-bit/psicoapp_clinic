-- migrate:transaction=false
-- Migration: down/105b_transcription_v4_indexes.sql

DROP INDEX CONCURRENTLY IF EXISTS uq_clinical_notes_draft_tenant_appt;
