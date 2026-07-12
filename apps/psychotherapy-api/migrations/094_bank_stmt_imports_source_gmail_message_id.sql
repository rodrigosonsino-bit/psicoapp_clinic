-- Migration: 094_bank_stmt_imports_source_gmail_message_id.sql
-- Descrição: coluna aditiva pra fechar a idempotência ponta a ponta do job
-- de e-mail (fonte da verdade de "e-mail já importado" gravada atomicamente
-- dentro da mesma transação que cria o import, ver
-- docs/email-bank-statement-ingestion-plan.md, seção "Deduplicação a nível
-- de e-mail"). NULL pro caminho de upload manual, sem mudança de
-- comportamento nele.

ALTER TABLE psychotherapy_bank_statement_imports
  ADD COLUMN source_gmail_message_id VARCHAR(100);
