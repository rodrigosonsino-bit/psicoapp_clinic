-- migrate:transaction=false
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_active_patient_document 
ON psychotherapy_patients(tenant_id, clean_document_immutable(document)) 
WHERE deleted_at IS NULL AND document IS NOT NULL AND clean_document_immutable(document) <> '';
