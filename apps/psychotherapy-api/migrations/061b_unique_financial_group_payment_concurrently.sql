-- migrate:transaction=false
-- Migration: 061b_unique_financial_group_payment_concurrently.sql
-- noTransaction

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_financial_payments_group_payment_id
ON financial_payments(tenant_id, group_payment_id)
WHERE group_payment_id IS NOT NULL;
