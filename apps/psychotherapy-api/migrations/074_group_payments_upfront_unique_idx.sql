-- 074_group_payments_upfront_unique_idx.sql
-- noTransaction

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_group_payments_upfront_active 
ON group_payments(tenant_id, group_member_id) 
WHERE charge_type = 'course_upfront' AND status <> 'voided';
