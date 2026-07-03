-- Migration: 060_fix_group_payments_contract.sql
-- Descrição: Ajustes transacionais para o modelo financeiro de grupos

BEGIN;

-- Remover default automático
ALTER TABLE group_payments ALTER COLUMN paid_at DROP DEFAULT;

-- Permitir método nulo enquanto cobrança está pendente
ALTER TABLE group_payments ALTER COLUMN payment_method DROP NOT NULL;

-- Limpar pendentes
UPDATE group_payments
SET paid_at = NULL,
    payment_method = NULL
WHERE status = 'pending';

-- Adicionar constraint de consistência
ALTER TABLE group_payments
ADD CONSTRAINT chk_group_payments_status_consistency
CHECK (
  (status = 'pending' AND paid_at IS NULL)
  OR
  (status = 'paid' AND paid_at IS NOT NULL AND payment_method IS NOT NULL)
  OR
  (status = 'voided' AND voided_at IS NOT NULL AND void_reason IS NOT NULL AND trim(void_reason) <> '')
) NOT VALID;

-- Validar a constraint imediatamente
ALTER TABLE group_payments VALIDATE CONSTRAINT chk_group_payments_status_consistency;

COMMIT;
