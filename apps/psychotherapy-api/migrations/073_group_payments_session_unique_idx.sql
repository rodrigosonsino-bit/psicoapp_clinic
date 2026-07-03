-- 073_group_payments_session_unique_idx.sql
-- noTransaction

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_group_payments_session_active 
ON group_payments(tenant_id, group_session_record_id) 
WHERE charge_type = 'session' AND status <> 'voided';
