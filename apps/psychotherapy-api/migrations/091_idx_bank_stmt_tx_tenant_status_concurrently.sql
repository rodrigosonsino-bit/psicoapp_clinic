-- migrate:transaction=false
-- Migration: 091_idx_bank_stmt_tx_tenant_status_concurrently.sql
-- noTransaction
--
-- Arquivo com um ÚNICO statement de propósito (ver lição da migration 081
-- em docs/bank-statement-reconciliation-plan.md / project_status memory —
-- CONCURRENTLY não pode dividir arquivo com outro statement, e o runner
-- só reconhece 1 nome de índice por arquivo não-transacional).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bank_stmt_tx_tenant_status
  ON psychotherapy_bank_statement_transactions (tenant_id, status);
