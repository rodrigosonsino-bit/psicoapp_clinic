-- Migration: 056_ledger_immutability.sql
-- Descrição: Criação da trigger de banco para garantir a imutabilidade do ledger financial_payments.

CREATE OR REPLACE FUNCTION protect_financial_payments_immutability()
RETURNS TRIGGER AS $$
BEGIN
    -- Bloquear DELETE
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'A exclusão física de registros financeiros do ledger é proibida.';
    END IF;

    -- Bloquear modificação de registros já estornados (status = voided)
    IF OLD.status = 'voided' THEN
        RAISE EXCEPTION 'Um pagamento estornado/cancelado não pode ser modificado.';
    END IF;

    -- Impedir alteração de campos chave
    IF NEW.id <> OLD.id OR
       NEW.tenant_id <> OLD.tenant_id OR
       NEW.patient_id <> OLD.patient_id OR
       NEW.amount_cents <> OLD.amount_cents OR
       NEW.currency <> OLD.currency OR
       NEW.idempotency_key <> OLD.idempotency_key OR
       NEW.created_by <> OLD.created_by OR
       NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'Os campos fundamentais de um pagamento do ledger são imutáveis.';
    END IF;

    -- Permitir exclusivamente confirmed -> voided
    IF OLD.status = 'confirmed' AND NEW.status = 'voided' THEN
        -- Exige preenchimento de voided_at, voided_by e void_reason
        IF NEW.voided_at IS NULL OR NEW.voided_by IS NULL OR NEW.void_reason IS NULL OR TRIM(NEW.void_reason) = '' THEN
            RAISE EXCEPTION 'Estornos exigem data, operador e justificativa obrigatórios.';
        END IF;

        -- Garante que voided_by pertence ao tenant do pagamento
        IF NEW.voided_by <> NEW.tenant_id THEN
            RAISE EXCEPTION 'O operador do estorno deve pertencer ao mesmo tenant do pagamento.';
        END IF;

        RETURN NEW;
    END IF;

    -- Impedir qualquer outra alteração de status (como voided -> confirmed, ou alteração silenciosa de confirmed -> confirmed)
    IF NEW.status <> OLD.status THEN
        RAISE EXCEPTION 'Transição de status inválida no ledger.';
    END IF;

    -- Se não houver alteração de status, impede qualquer UPDATE geral
    RAISE EXCEPTION 'Não é permitido atualizar registros do ledger sem transição de estorno.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_financial_payments ON financial_payments;

CREATE TRIGGER trg_protect_financial_payments
BEFORE UPDATE OR DELETE ON financial_payments
FOR EACH ROW
EXECUTE FUNCTION protect_financial_payments_immutability();

-- Revogar permissão física de DELETE da role pública/padrão
REVOKE DELETE ON TABLE financial_payments FROM PUBLIC;
REVOKE DELETE ON TABLE financial_payments FROM CURRENT_USER;
