-- Migration: 057_expand_group_financial_model.sql
-- Descrição: Expande o modelo financeiro de grupos, introduz modalidade individual e vincula pagamentos de grupo ao ledger.

BEGIN;

-- 1. Modalidade Individual
ALTER TABLE psychotherapy_patients
    ADD COLUMN individual_therapy_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. Pagamentos de Grupo (group_payments)
-- Criar constraint para FK composta (tenant isolation)
ALTER TABLE group_payments ADD CONSTRAINT uq_group_payments_id_tenant UNIQUE (id, tenant_id);

-- Opcional: group_session_records precisa de chave candidata para FK
ALTER TABLE group_session_records ADD CONSTRAINT uq_group_session_records_id_tenant UNIQUE (id, tenant_id);

ALTER TABLE group_payments
    ADD COLUMN status VARCHAR(20) NULL CHECK (status IS NULL OR status IN ('pending', 'paid', 'voided')),
    ADD COLUMN due_date DATE NULL,
    ADD COLUMN voided_at TIMESTAMPTZ,
    ADD COLUMN voided_by UUID REFERENCES tenants(id) ON DELETE RESTRICT,
    ADD COLUMN void_reason TEXT,
    ADD COLUMN replacement_for_id UUID,
    ADD COLUMN group_session_record_id UUID,
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- FKs seguras preservando tenant_id
ALTER TABLE group_payments
    ADD CONSTRAINT fk_group_payments_replacement
    FOREIGN KEY (replacement_for_id, tenant_id) REFERENCES group_payments(id, tenant_id) ON DELETE RESTRICT;

ALTER TABLE group_payments
    ADD CONSTRAINT fk_group_payments_session
    FOREIGN KEY (group_session_record_id, tenant_id) REFERENCES group_session_records(id, tenant_id) ON DELETE RESTRICT;

-- Tornar paid_at nullable para comportar cobranças pendentes
ALTER TABLE group_payments ALTER COLUMN paid_at DROP NOT NULL;
ALTER TABLE group_payments ALTER COLUMN paid_at SET DEFAULT NOW();

-- 3. Integração com o Ledger (financial_payments)
ALTER TABLE financial_payments ADD COLUMN group_payment_id UUID NULL;

ALTER TABLE financial_payments
    ADD CONSTRAINT fk_financial_payments_group
    FOREIGN KEY (group_payment_id, tenant_id) REFERENCES group_payments(id, tenant_id) ON DELETE RESTRICT;

-- 4. Atualizar imutabilidade
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
       NEW.group_payment_id IS DISTINCT FROM OLD.group_payment_id OR
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

-- 5. Tabela de Idempotência
CREATE TABLE IF NOT EXISTS group_member_creation_requests (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    operation VARCHAR(50) NOT NULL,
    idempotency_key UUID NOT NULL,
    request_hash CHAR(64) NOT NULL,
    group_id UUID NOT NULL,
    patient_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, operation, idempotency_key),
    FOREIGN KEY (group_id, tenant_id) REFERENCES therapy_groups(id, tenant_id) ON DELETE RESTRICT,
    FOREIGN KEY (patient_id, tenant_id) REFERENCES psychotherapy_patients(id, tenant_id) ON DELETE RESTRICT
);

COMMIT;
