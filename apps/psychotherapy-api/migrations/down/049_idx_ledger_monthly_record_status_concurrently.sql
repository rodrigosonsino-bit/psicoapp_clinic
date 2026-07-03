-- Down Migration: 049_idx_ledger_monthly_record_status_concurrently.sql
DROP INDEX CONCURRENTLY IF EXISTS idx_ledger_monthly_record_status;
