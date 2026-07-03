-- 072_group_payments_monthly_unique_idx.sql
-- noTransaction

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_group_payments_monthly_active 
ON group_payments(tenant_id, group_member_id, reference_month) 
WHERE charge_type = 'monthly' AND status <> 'voided';
