-- Down Migration: 050_idx_failed_totp_tenant_ip_time_concurrently.sql
DROP INDEX CONCURRENTLY IF EXISTS idx_failed_totp_tenant_ip_time;
