-- migrate:transaction=false
DROP INDEX CONCURRENTLY IF EXISTS uq_patients_idx;
