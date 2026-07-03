-- migrate:transaction=false
DROP INDEX CONCURRENTLY IF EXISTS uq_active_patient_document;
