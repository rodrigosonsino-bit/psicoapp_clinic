-- migrate:transaction=false
-- Migration: down/058_group_financial_indexes_concurrently.sql

DROP INDEX CONCURRENTLY IF EXISTS idx_group_payments_status_due;
DROP INDEX CONCURRENTLY IF EXISTS idx_group_payments_session;
DROP INDEX CONCURRENTLY IF EXISTS idx_fin_payments_group_payment;
DROP INDEX CONCURRENTLY IF EXISTS idx_individual_therapy_enabled;
