-- migrate:transaction=false
DROP INDEX CONCURRENTLY IF EXISTS uq_sessions_idx;
