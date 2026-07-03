-- migrate:transaction=false
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_groups_idx ON therapy_groups(id, tenant_id);
