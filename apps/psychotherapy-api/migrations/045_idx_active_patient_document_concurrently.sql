-- migrate:transaction=false
CREATE UNIQUE INDEX CONCURRENTLY idx_active_patient_document 
ON psychotherapy_patients(tenant_id, regexp_replace(document, '[^\d]', '', 'g')) 
WHERE deleted_at IS NULL AND document IS NOT NULL AND regexp_replace(document, '[^\d]', '', 'g') <> '';
