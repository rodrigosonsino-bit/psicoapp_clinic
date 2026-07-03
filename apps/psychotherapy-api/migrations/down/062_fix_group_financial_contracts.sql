-- Down: 062_fix_group_financial_contracts.sql
-- AVISO: forward-only recomendado para dados financeiros.
-- Este script reverte apenas o esquema (DDL), NÃO os dados do backfill.
-- Para rollback completo, restaurar backup anterior à migration.

DROP TRIGGER IF EXISTS trg_protect_gp_original_amount ON group_payments;
DROP FUNCTION IF EXISTS protect_group_payment_original_amount();
ALTER TABLE group_payments DROP CONSTRAINT IF EXISTS chk_gp_paid_amount;
ALTER TABLE group_payments DROP COLUMN IF EXISTS amount_paid_cents;
ALTER TABLE group_payments DROP COLUMN IF EXISTS original_amount_cents;
-- NOTA: uq_group_payment_installment NÃO é restaurada automaticamente.
-- Restaurá-la após substituições/voids pode violar dados existentes.
-- Restauração manual somente após auditoria.
