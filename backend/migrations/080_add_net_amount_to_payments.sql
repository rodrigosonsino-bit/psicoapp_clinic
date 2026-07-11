-- Migration: 080_add_net_amount_to_payments.sql
-- Descrição: Adiciona modelo bruto/taxa/líquido (processing_fee_cents/net_amount_cents) ao
--   ledger (financial_payments) e às cobranças de grupo (group_payments).
-- Runner gerencia a transação — NÃO incluir BEGIN/COMMIT aqui.
--
-- ATENÇÃO (achado em revisão, 04/07/2026): o backfill de group_payments NÃO pode setar
-- processing_fee_cents=0 incondicionalmente pra todo status != 'pending'. Uma cobrança pode
-- ser anulada (VoidGroupPaymentUseCase) ANTES de ser paga (amount_paid_cents fica NULL —
-- ver constraint chk_gp_paid_amount da migration 062, que permite voided com
-- amount_paid_cents NULL). Se net/fee forem setados incondicionalmente, essas linhas ficam
-- com net_amount_cents=NULL mas processing_fee_cents=0, violando a constraint abaixo.
-- Por isso o backfill aqui só toca linhas onde amount_paid_cents JÁ está preenchido.

-- ── 1. Lock exclusivo nas duas tabelas (evita escrita concorrente durante o backfill) ──
LOCK TABLE financial_payments IN ACCESS EXCLUSIVE MODE;
LOCK TABLE group_payments     IN ACCESS EXCLUSIVE MODE;

-- ── 2. Novas colunas ──────────────────────────────────────────────────────────
ALTER TABLE financial_payments ADD COLUMN IF NOT EXISTS processing_fee_cents INTEGER;
ALTER TABLE financial_payments ADD COLUMN IF NOT EXISTS net_amount_cents     INTEGER;

ALTER TABLE group_payments ADD COLUMN IF NOT EXISTS processing_fee_cents INTEGER;
ALTER TABLE group_payments ADD COLUMN IF NOT EXISTS net_amount_cents     INTEGER;

-- ── 3. Remover temporariamente a trigger de imutabilidade do ledger ────────────
-- A função atual rejeita QUALQUER UPDATE que não seja a transição confirmed->voided
-- (inclusive um UPDATE só de colunas novas) — precisa ser removida antes do backfill
-- e recriada depois já com a lista de campos imutáveis atualizada.
DROP TRIGGER IF EXISTS trg_protect_financial_payments ON financial_payments;

-- ── 4. Backfill ───────────────────────────────────────────────────────────────
-- financial_payments: todo registro sempre teve amount_cents preenchido (não existe estado
-- "pending" no ledger — só é inserido quando o dinheiro já foi confirmado). Assume-se taxa
-- zero para todo o histórico anterior a este modelo (não havia distinção bruto/líquido antes).
UPDATE financial_payments
SET net_amount_cents = amount_cents,
    processing_fee_cents = 0
WHERE net_amount_cents IS NULL;

ALTER TABLE financial_payments
  ALTER COLUMN net_amount_cents SET NOT NULL,
  ALTER COLUMN processing_fee_cents SET NOT NULL;

-- group_payments: só preenche net/fee onde já existe amount_paid_cents (paid, ou voided
-- que já tinha sido pago antes de ser estornado). Cobranças pending, ou voided-antes-de-
-- pagas (amount_paid_cents IS NULL), ficam com net/fee NULL — estado válido, sem taxa a
-- reportar porque nenhum dinheiro chegou a ser processado.
UPDATE group_payments
SET net_amount_cents = amount_paid_cents,
    processing_fee_cents = 0
WHERE amount_paid_cents IS NOT NULL
  AND net_amount_cents IS NULL;

-- group_payments NÃO recebe NOT NULL: pending é um estado legítimo sem valor.

-- ── 5. Recriar a trigger de imutabilidade incluindo os novos campos ────────────
CREATE OR REPLACE FUNCTION protect_financial_payments_immutability()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'A exclusão física de registros financeiros do ledger é proibida.';
    END IF;

    IF OLD.status = 'voided' THEN
        RAISE EXCEPTION 'Um pagamento estornado/cancelado não pode ser modificado.';
    END IF;

    -- Comparações com IS DISTINCT FROM (não <>): trata NULL corretamente, ao contrário
    -- da versão anterior (migration 056) que usava <> e deixava mudança NULL->valor passar.
    IF NEW.id IS DISTINCT FROM OLD.id OR
       NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
       NEW.patient_id IS DISTINCT FROM OLD.patient_id OR
       NEW.amount_cents IS DISTINCT FROM OLD.amount_cents OR
       NEW.net_amount_cents IS DISTINCT FROM OLD.net_amount_cents OR
       NEW.processing_fee_cents IS DISTINCT FROM OLD.processing_fee_cents OR
       NEW.currency IS DISTINCT FROM OLD.currency OR
       NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR
       NEW.created_by IS DISTINCT FROM OLD.created_by OR
       NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Os campos fundamentais de um pagamento do ledger são imutáveis.';
    END IF;

    IF OLD.status = 'confirmed' AND NEW.status = 'voided' THEN
        IF NEW.voided_at IS NULL OR NEW.voided_by IS NULL OR NEW.void_reason IS NULL OR TRIM(NEW.void_reason) = '' THEN
            RAISE EXCEPTION 'Estornos exigem data, operador e justificativa obrigatórios.';
        END IF;

        IF NEW.voided_by <> NEW.tenant_id THEN
            RAISE EXCEPTION 'O operador do estorno deve pertencer ao mesmo tenant do pagamento.';
        END IF;

        RETURN NEW;
    END IF;

    IF NEW.status <> OLD.status THEN
        RAISE EXCEPTION 'Transição de status inválida no ledger.';
    END IF;

    RAISE EXCEPTION 'Não é permitido atualizar registros do ledger sem transição de estorno.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_protect_financial_payments
BEFORE UPDATE OR DELETE ON financial_payments
FOR EACH ROW
EXECUTE FUNCTION protect_financial_payments_immutability();

-- ── 6. Constraints de estado (NOT VALID primeiro, VALIDATE depois — reduz bloqueio) ──
ALTER TABLE financial_payments
  ADD CONSTRAINT chk_fin_net_amount CHECK (net_amount_cents > 0) NOT VALID;
ALTER TABLE financial_payments
  ADD CONSTRAINT chk_fin_fee CHECK (processing_fee_cents >= 0) NOT VALID;
ALTER TABLE financial_payments
  ADD CONSTRAINT chk_fin_math CHECK (net_amount_cents + processing_fee_cents = amount_cents) NOT VALID;

-- group_payments: a relação entre status e amount_paid_cents já é regida pela constraint
-- chk_gp_paid_amount (migration 062) — aqui só amarramos net/fee a amount_paid_cents
-- diretamente, sem duplicar a lógica de status (evita as duas constraints divergirem
-- no futuro se uma for alterada sem a outra).
ALTER TABLE group_payments
  ADD CONSTRAINT chk_group_payments_net_fee CHECK (
    (amount_paid_cents IS NULL AND net_amount_cents IS NULL AND processing_fee_cents IS NULL)
    OR
    (
      amount_paid_cents IS NOT NULL
      AND net_amount_cents > 0
      AND processing_fee_cents >= 0
      AND net_amount_cents + processing_fee_cents = amount_paid_cents
    )
  ) NOT VALID;

ALTER TABLE financial_payments VALIDATE CONSTRAINT chk_fin_net_amount;
ALTER TABLE financial_payments VALIDATE CONSTRAINT chk_fin_fee;
ALTER TABLE financial_payments VALIDATE CONSTRAINT chk_fin_math;
ALTER TABLE group_payments VALIDATE CONSTRAINT chk_group_payments_net_fee;
