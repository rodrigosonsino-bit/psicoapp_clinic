-- migrate:transaction=false
CREATE INDEX CONCURRENTLY idx_ledger_tenant_paid_at 
ON financial_payments(tenant_id, paid_at DESC);
