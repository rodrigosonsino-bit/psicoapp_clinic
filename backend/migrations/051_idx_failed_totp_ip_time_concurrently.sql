-- migrate:transaction=false
CREATE INDEX CONCURRENTLY idx_failed_totp_ip_time 
ON failed_totp_attempts(ip_address, attempted_at DESC);
