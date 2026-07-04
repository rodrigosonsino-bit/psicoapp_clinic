-- Migration: 084_card_fee_rates_and_installments_audit.sql
-- Descrição: (1) tabela de taxas de cartão configurável por tenant (sugestão de UI, não
--   regra de negócio no backend); (2) auditoria de parcelas/taxa aplicada em pagamentos de
--   grupo e no ledger, pra permitir reconstruir depois por que um líquido ficou em X.
-- Runner gerencia a transação — NÃO incluir BEGIN/COMMIT aqui.
--
-- Tudo aditivo/nullable: nenhuma linha existente muda de valor, nenhum default obrigatório.

-- ── 1. Taxas de cartão configuráveis por tenant ────────────────────────────────
-- Formato: {"1": 350, "2": 450, ..., "12": 1590} — chave = nº de parcelas (string "1"-"12"),
-- valor = basis points (350 = 3,50%). Ausência da coluna/chave = sem sugestão (comportamento
-- atual do modal preservado). Validação de formato/faixa fica no Zod da rota; aqui só o tipo.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS card_fee_rates JSONB;

-- ── 2. Auditoria: parcelas do cartão e taxa aplicada na sugestão ───────────────
-- Preenchidos só quando o método de pagamento é cartão de crédito e havia taxa configurada
-- pro número de parcelas escolhido. NÃO são a fonte da verdade financeira (que continua
-- sendo net_amount_cents/processing_fee_cents, digitados/confirmados pelo operador) — servem
-- só pra registrar qual sugestão originou aquele valor, pra investigação futura.
ALTER TABLE group_payments ADD COLUMN IF NOT EXISTS card_installments SMALLINT;
ALTER TABLE group_payments ADD COLUMN IF NOT EXISTS applied_fee_bps INTEGER;

ALTER TABLE financial_payments ADD COLUMN IF NOT EXISTS card_installments SMALLINT;
ALTER TABLE financial_payments ADD COLUMN IF NOT EXISTS applied_fee_bps INTEGER;

ALTER TABLE group_payments
  ADD CONSTRAINT chk_gp_card_installments CHECK (card_installments IS NULL OR card_installments BETWEEN 1 AND 12) NOT VALID;
ALTER TABLE group_payments
  ADD CONSTRAINT chk_gp_applied_fee_bps CHECK (applied_fee_bps IS NULL OR applied_fee_bps BETWEEN 0 AND 10000) NOT VALID;

ALTER TABLE financial_payments
  ADD CONSTRAINT chk_fin_card_installments CHECK (card_installments IS NULL OR card_installments BETWEEN 1 AND 12) NOT VALID;
ALTER TABLE financial_payments
  ADD CONSTRAINT chk_fin_applied_fee_bps CHECK (applied_fee_bps IS NULL OR applied_fee_bps BETWEEN 0 AND 10000) NOT VALID;

ALTER TABLE group_payments VALIDATE CONSTRAINT chk_gp_card_installments;
ALTER TABLE group_payments VALIDATE CONSTRAINT chk_gp_applied_fee_bps;
ALTER TABLE financial_payments VALIDATE CONSTRAINT chk_fin_card_installments;
ALTER TABLE financial_payments VALIDATE CONSTRAINT chk_fin_applied_fee_bps;

-- ── 3. Trigger de imutabilidade do ledger: incluir os 2 campos novos ───────────
-- Não precisa dropar/recriar a trigger (como a migration 080 fez) — não há backfill de
-- dados aqui que violaria a versão atual da função; só substituímos o corpo (CREATE OR
-- REPLACE), que passa a valer imediatamente pro trigger já existente.
CREATE OR REPLACE FUNCTION protect_financial_payments_immutability()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'A exclusão física de registros financeiros do ledger é proibida.';
    END IF;

    IF OLD.status = 'voided' THEN
        RAISE EXCEPTION 'Um pagamento estornado/cancelado não pode ser modificado.';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id OR
       NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
       NEW.patient_id IS DISTINCT FROM OLD.patient_id OR
       NEW.amount_cents IS DISTINCT FROM OLD.amount_cents OR
       NEW.net_amount_cents IS DISTINCT FROM OLD.net_amount_cents OR
       NEW.processing_fee_cents IS DISTINCT FROM OLD.processing_fee_cents OR
       NEW.card_installments IS DISTINCT FROM OLD.card_installments OR
       NEW.applied_fee_bps IS DISTINCT FROM OLD.applied_fee_bps OR
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
