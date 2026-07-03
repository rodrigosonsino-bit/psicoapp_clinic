-- migrate:transaction=false
DROP INDEX CONCURRENTLY IF EXISTS uq_appointments_idx;
