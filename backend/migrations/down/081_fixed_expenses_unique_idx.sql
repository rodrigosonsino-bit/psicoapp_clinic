-- Down: 081_fixed_expenses_unique_idx.sql
-- migrate:transaction=false

DROP INDEX CONCURRENTLY IF EXISTS uq_psychotherapy_expenses_fixed_month;
