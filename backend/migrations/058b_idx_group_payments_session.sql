-- migrate:transaction=false
-- Migration: 058b_idx_group_payments_session.sql
-- noTransaction

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_group_payments_session
    ON group_payments(tenant_id, group_session_record_id)
    WHERE group_session_record_id IS NOT NULL;
