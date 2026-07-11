-- Migration: 059_backfill_group_payments_status.sql
-- Descrição: Backfill do status para paid nos group_payments legados e torna a coluna NOT NULL.

BEGIN;

UPDATE group_payments 
SET status = 'paid' 
WHERE status IS NULL;

-- Como as cobranças novas nascem com status, podemos tornar NOT NULL
-- Isso garante integridade do novo modelo.
ALTER TABLE group_payments ALTER COLUMN status SET NOT NULL;
ALTER TABLE group_payments ALTER COLUMN status SET DEFAULT 'pending';

COMMIT;
