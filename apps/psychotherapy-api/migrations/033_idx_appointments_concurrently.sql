-- migrate:transaction=false
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_appointments_idx ON psychotherapy_appointments(id, tenant_id);
