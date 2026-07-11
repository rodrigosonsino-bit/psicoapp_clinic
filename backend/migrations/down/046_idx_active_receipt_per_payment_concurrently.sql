-- Down Migration: 046_idx_active_receipt_per_payment_concurrently.sql
DROP INDEX CONCURRENTLY IF EXISTS idx_active_receipt_per_payment;
