-- migrate:transaction=false
-- Migration: 061a_drop_old_index_concurrently.sql
-- noTransaction

DROP INDEX CONCURRENTLY IF EXISTS idx_fin_payments_group_payment;
