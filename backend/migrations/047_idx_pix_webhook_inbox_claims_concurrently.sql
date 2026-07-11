-- migrate:transaction=false
CREATE INDEX CONCURRENTLY idx_pix_webhook_inbox_claims 
ON pix_webhook_inbox(status, next_attempt_at, locked_until, received_at);
