-- Down Migration: 048_idx_ledger_tenant_paid_at_concurrently.sql
DROP INDEX CONCURRENTLY IF EXISTS idx_ledger_tenant_paid_at;
