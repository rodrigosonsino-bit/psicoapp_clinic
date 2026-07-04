-- Down: 084_card_fee_rates_and_installments_audit.sql
-- Reverte apenas o esquema (DDL). Os valores de card_fee_rates/card_installments/
-- applied_fee_bps existentes são perdidos ao remover as colunas.

ALTER TABLE group_payments DROP CONSTRAINT IF EXISTS chk_gp_card_installments;
ALTER TABLE group_payments DROP CONSTRAINT IF EXISTS chk_gp_applied_fee_bps;
ALTER TABLE financial_payments DROP CONSTRAINT IF EXISTS chk_fin_card_installments;
ALTER TABLE financial_payments DROP CONSTRAINT IF EXISTS chk_fin_applied_fee_bps;

-- Restaura a versão da função sem os 2 campos novos (equivalente à saída da migration 080).
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

ALTER TABLE group_payments DROP COLUMN IF EXISTS card_installments;
ALTER TABLE group_payments DROP COLUMN IF EXISTS applied_fee_bps;
ALTER TABLE financial_payments DROP COLUMN IF EXISTS card_installments;
ALTER TABLE financial_payments DROP COLUMN IF EXISTS applied_fee_bps;
ALTER TABLE tenants DROP COLUMN IF EXISTS card_fee_rates;
