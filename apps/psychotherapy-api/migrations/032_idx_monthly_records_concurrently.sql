-- migrate:transaction=false
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_monthly_records_idx ON psychotherapy_monthly_records(id, tenant_id);
