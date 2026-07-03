-- migrate:transaction=false
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_active_patients_tenant_name 
ON psychotherapy_patients(tenant_id, name) 
WHERE deleted_at IS NULL;
