-- Migration: down/057_expand_group_financial_model.sql
-- Descrição: Reverte as alterações do modelo financeiro de grupos e modalidade individual.

BEGIN;

-- 1. Idempotência
DROP TABLE IF EXISTS group_member_creation_requests;

-- 2. Atualizar imutabilidade
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

    -- Impedir alteração de campos chave (sem group_payment_id)
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

-- 3. Integração com o Ledger (financial_payments)
ALTER TABLE financial_payments DROP CONSTRAINT IF EXISTS fk_financial_payments_group;
ALTER TABLE financial_payments DROP COLUMN IF EXISTS group_payment_id;

-- 4. Pagamentos de Grupo (group_payments)
ALTER TABLE group_payments DROP CONSTRAINT IF EXISTS fk_group_payments_session;
ALTER TABLE group_payments DROP CONSTRAINT IF EXISTS fk_group_payments_replacement;
ALTER TABLE group_session_records DROP CONSTRAINT IF EXISTS uq_group_session_records_id_tenant;
ALTER TABLE group_payments DROP CONSTRAINT IF EXISTS uq_group_payments_id_tenant;

ALTER TABLE group_payments
    DROP COLUMN IF EXISTS status,
    DROP COLUMN IF EXISTS due_date,
    DROP COLUMN IF EXISTS voided_at,
    DROP COLUMN IF EXISTS voided_by,
    DROP COLUMN IF EXISTS void_reason,
    DROP COLUMN IF EXISTS replacement_for_id,
    DROP COLUMN IF EXISTS group_session_record_id,
    DROP COLUMN IF EXISTS updated_at;

-- Restaurar paid_at (com defaults que possam ser necessários)
ALTER TABLE group_payments ALTER COLUMN paid_at SET NOT NULL;
ALTER TABLE group_payments ALTER COLUMN paid_at SET DEFAULT NOW();

-- 5. Modalidade Individual
ALTER TABLE psychotherapy_patients DROP COLUMN IF EXISTS individual_therapy_enabled;

COMMIT;
