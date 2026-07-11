-- Down Migration: 045_idx_active_patient_document_concurrently.sql
DROP INDEX CONCURRENTLY IF EXISTS idx_active_patient_document;
