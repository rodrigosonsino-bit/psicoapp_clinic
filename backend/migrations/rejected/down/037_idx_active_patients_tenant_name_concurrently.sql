-- migrate:transaction=false
DROP INDEX CONCURRENTLY IF EXISTS idx_active_patients_tenant_name;
