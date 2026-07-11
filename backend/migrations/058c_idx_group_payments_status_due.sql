-- migrate:transaction=false
-- Migration: 058c_idx_group_payments_status_due.sql
-- noTransaction

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_group_payments_status_due
    ON group_payments(tenant_id, status, due_date)
    WHERE status IS NOT NULL;
