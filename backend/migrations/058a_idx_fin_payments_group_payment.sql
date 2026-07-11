-- migrate:transaction=false
-- Migration: 058a_idx_fin_payments_group_payment.sql
-- noTransaction

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fin_payments_group_payment
    ON financial_payments(tenant_id, group_payment_id)
    WHERE group_payment_id IS NOT NULL;
