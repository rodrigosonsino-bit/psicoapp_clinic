-- migrate:transaction=false
CREATE INDEX CONCURRENTLY idx_ledger_monthly_record_status 
ON financial_payments(monthly_record_id, status) 
WHERE status = 'confirmed';
