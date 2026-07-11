-- Down Migration: 047_idx_pix_webhook_inbox_claims_concurrently.sql
DROP INDEX CONCURRENTLY IF EXISTS idx_pix_webhook_inbox_claims;
