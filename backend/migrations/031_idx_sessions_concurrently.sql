-- migrate:transaction=false
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_sessions_idx ON psychotherapy_sessions(id, tenant_id);
