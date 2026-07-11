-- migrate:transaction=false
CREATE UNIQUE INDEX CONCURRENTLY idx_active_receipt_per_payment 
ON psychotherapy_receipts(payment_id) 
WHERE status = 'issued' AND payment_id IS NOT NULL;
