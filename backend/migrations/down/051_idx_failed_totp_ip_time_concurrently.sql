-- Down Migration: 051_idx_failed_totp_ip_time_concurrently.sql
DROP INDEX CONCURRENTLY IF EXISTS idx_failed_totp_ip_time;
