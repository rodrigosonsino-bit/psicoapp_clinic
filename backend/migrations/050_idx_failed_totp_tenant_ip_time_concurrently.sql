-- migrate:transaction=false
CREATE INDEX CONCURRENTLY idx_failed_totp_tenant_ip_time 
ON failed_totp_attempts(tenant_id, ip_address, attempted_at DESC);
