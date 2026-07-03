-- migrate:transaction=false
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_patients_idx ON psychotherapy_patients(id, tenant_id);
