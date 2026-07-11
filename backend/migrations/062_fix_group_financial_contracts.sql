-- Migration: 062_fix_group_financial_contracts.sql
-- Descrição: Correções aditivas ao modelo financeiro de grupos.
--   1. Remove constraint legada de parcelas (bloqueia substituições após void)
--   2. Preflight abortivo de duplicatas (nunca saneamento automático)
--   3. Adiciona original_amount_cents (imutável após inserção)
--   4. Adiciona amount_paid_cents (preenchido apenas na confirmação)
--   5. Constraint de consistência entre status e amount_paid_cents
--   6. Trigger protegendo original_amount_cents de alteração
--
-- ATENÇÃO: se esta migration já constar em schema_migrations, criar 066 com o mesmo conteúdo.
-- Runner gerencia a transação — NÃO incluir BEGIN/COMMIT aqui.

-- ── 1. Remover constraint legada de parcelas ─────────────────────────────────
-- uq_group_payment_installment impede nova cobrança para o mesmo
-- reference_month/installment_number após um void, quebrando ReplaceGroupCharge.
ALTER TABLE group_payments DROP CONSTRAINT IF EXISTS uq_group_payment_installment;

-- ── 2. Preflight de duplicatas — ABORTIVO, nunca silencioso ──────────────────
-- Cobranças paid duplicadas bloqueiam o deploy (reconciliação manual obrigatória).
-- Cobranças pending duplicadas também bloqueiam (saneamento manual obrigatório).
-- O DBA deve: (a) rodar query de auditoria, (b) fazer void manual das duplicatas
-- com preenchimento correto de voided_at/voided_by/void_reason, (c) reaplicar.
DO $$
DECLARE
  cnt_pending INT;
  cnt_paid    INT;
BEGIN
  SELECT COUNT(*) INTO cnt_paid FROM (
    SELECT tenant_id, group_id, patient_id, reference_month
    FROM group_payments
    WHERE status = 'paid'
    GROUP BY tenant_id, group_id, patient_id, reference_month
    HAVING COUNT(*) > 1
  ) t;

  SELECT COUNT(*) INTO cnt_pending FROM (
    SELECT tenant_id, group_id, patient_id, reference_month
    FROM group_payments
    WHERE status = 'pending'
    GROUP BY tenant_id, group_id, patient_id, reference_month
    HAVING COUNT(*) > 1
  ) t;

  IF cnt_paid > 0 THEN
    RAISE EXCEPTION
      'BLOQUEIO: % combinação(ões) com cobranças PAGAS duplicadas. '
      'Reconciliação manual obrigatória antes de continuar. '
      'Query de diagnóstico: SELECT tenant_id, group_id, patient_id, reference_month, COUNT(*) '
      'FROM group_payments WHERE status = ''paid'' '
      'GROUP BY tenant_id, group_id, patient_id, reference_month HAVING COUNT(*) > 1;',
      cnt_paid;
  END IF;

  IF cnt_pending > 0 THEN
    RAISE EXCEPTION
      'BLOQUEIO: % combinação(ões) com cobranças PENDING duplicadas. '
      'Saneamento manual obrigatório antes de continuar. '
      'Query de diagnóstico: SELECT tenant_id, group_id, patient_id, reference_month, COUNT(*) '
      'FROM group_payments WHERE status = ''pending'' '
      'GROUP BY tenant_id, group_id, patient_id, reference_month HAVING COUNT(*) > 1;',
      cnt_pending;
  END IF;
END;
$$;

-- ── 3. Coluna original_amount_cents ──────────────────────────────────────────
-- Preserva o valor original definido na criação. Imutável após inserção (via trigger abaixo).
ALTER TABLE group_payments
  ADD COLUMN IF NOT EXISTS original_amount_cents INTEGER CHECK (original_amount_cents > 0);

-- Backfill para registros existentes (usa o amount_cents atual como proxy do original)
UPDATE group_payments
  SET original_amount_cents = amount_cents
  WHERE original_amount_cents IS NULL;

ALTER TABLE group_payments
  ALTER COLUMN original_amount_cents SET NOT NULL;

-- ── 4. Coluna amount_paid_cents ───────────────────────────────────────────────
-- Valor efetivamente recebido. NULL enquanto pendente; preenchido na confirmação.
ALTER TABLE group_payments
  ADD COLUMN IF NOT EXISTS amount_paid_cents INTEGER CHECK (amount_paid_cents > 0);

-- Backfill para cobranças já pagas
UPDATE group_payments
  SET amount_paid_cents = amount_cents
  WHERE status = 'paid' AND amount_paid_cents IS NULL;

-- ── 5. Constraint de consistência status <-> amount_paid_cents ───────────────
ALTER TABLE group_payments
  ADD CONSTRAINT chk_gp_paid_amount CHECK (
    (status = 'pending' AND amount_paid_cents IS NULL) OR
    (status = 'paid'    AND amount_paid_cents IS NOT NULL) OR
    (status = 'voided')
  ) NOT VALID;

ALTER TABLE group_payments VALIDATE CONSTRAINT chk_gp_paid_amount;

-- ── 6. Trigger: original_amount_cents é imutável após inserção ───────────────
CREATE OR REPLACE FUNCTION protect_group_payment_original_amount()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.original_amount_cents IS NOT NULL
     AND NEW.original_amount_cents IS DISTINCT FROM OLD.original_amount_cents THEN
    RAISE EXCEPTION
      'original_amount_cents é imutável após a criação da cobrança (id: %). '
      'Para corrigir o valor, use void + replace.',
      OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_gp_original_amount ON group_payments;
CREATE TRIGGER trg_protect_gp_original_amount
  BEFORE UPDATE ON group_payments
  FOR EACH ROW EXECUTE FUNCTION protect_group_payment_original_amount();
