-- migrate:transaction=false
-- Migration: 095_idx_bank_stmt_imports_gmail_message_id_concurrently.sql
-- noTransaction
--
-- Arquivo com um ÚNICO statement de propósito (mesma regra já usada em
-- 091/092 — CONCURRENTLY não pode dividir arquivo com outro statement, e o
-- runner só reconhece 1 nome de índice por arquivo não-transacional). Deve
-- ser aplicada DEPOIS de 094 (ordem alfabética garante isso).

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_bank_stmt_imports_gmail_message_id
  ON psychotherapy_bank_statement_imports (tenant_id, source_gmail_message_id)
  WHERE source_gmail_message_id IS NOT NULL;
