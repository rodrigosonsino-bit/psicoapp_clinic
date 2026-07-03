-- 079_therapy_group_billing_policies_and_refunds.sql

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE therapy_group_member_billing_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    group_id UUID NOT NULL,
    patient_id UUID NOT NULL,
    member_id UUID NOT NULL,
    billing_type VARCHAR(50) NOT NULL CHECK (billing_type IN ('group_default', 'upfront', 'exempt')),
    valid_from DATE NOT NULL,
    valid_until DATE,
    upfront_payment_id UUID,
    exemption_reason TEXT,
    approved_by UUID NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled')),
    canceled_at TIMESTAMPTZ,
    canceled_by UUID,
    cancel_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    FOREIGN KEY (member_id, tenant_id) REFERENCES therapy_group_members(id, tenant_id),
    FOREIGN KEY (upfront_payment_id, tenant_id) REFERENCES financial_payments(id, tenant_id),
    
    CHECK (valid_until IS NULL OR valid_until >= valid_from),
    CHECK (
      (billing_type = 'group_default' AND upfront_payment_id IS NULL AND exemption_reason IS NULL) OR
      (billing_type = 'upfront' AND upfront_payment_id IS NOT NULL AND exemption_reason IS NULL) OR
      (billing_type = 'exempt' AND upfront_payment_id IS NULL AND trim(exemption_reason) <> '')
    )
);

CREATE UNIQUE INDEX uq_policies_upfront_payment 
ON therapy_group_member_billing_policies(tenant_id, upfront_payment_id) 
WHERE upfront_payment_id IS NOT NULL;

ALTER TABLE therapy_group_member_billing_policies 
ADD CONSTRAINT exclude_overlapping_policies 
EXCLUDE USING gist (
    tenant_id WITH =, 
    member_id WITH =, 
    daterange(valid_from, valid_until, '[]') WITH &&
) WHERE (status = 'active');

CREATE TABLE upfront_refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    payment_id UUID NOT NULL,
    policy_id UUID NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
    reason TEXT NOT NULL,
    operator_id UUID NOT NULL,
    amount_cents INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    idempotency_key UUID NOT NULL,
    
    FOREIGN KEY (payment_id, tenant_id) REFERENCES financial_payments(id, tenant_id),
    FOREIGN KEY (policy_id, tenant_id) REFERENCES therapy_group_member_billing_policies(id, tenant_id),
    CHECK (amount_cents > 0),
    CHECK (trim(reason) <> ''),
    UNIQUE (tenant_id, payment_id)
);

-- Triggers for immutability and refund coordination
CREATE OR REPLACE FUNCTION trg_verify_upfront_payment_fn() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.billing_type = 'upfront' THEN
        IF NOT EXISTS (
            SELECT 1 
            FROM financial_payments fp
            JOIN group_payments gp ON gp.id = fp.group_payment_id
            WHERE fp.id = NEW.upfront_payment_id
              AND fp.tenant_id = NEW.tenant_id
              AND fp.patient_id = NEW.patient_id
              AND fp.status = 'confirmed'
              AND gp.charge_type = 'course_upfront'
              AND gp.group_member_id = NEW.member_id
        ) THEN
            RAISE EXCEPTION 'O pagamento upfront não é válido para esta matrícula, não está confirmado, ou não pertence a uma cobrança course_upfront.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_verify_upfront_payment
BEFORE INSERT OR UPDATE ON therapy_group_member_billing_policies
FOR EACH ROW EXECUTE FUNCTION trg_verify_upfront_payment_fn();

CREATE OR REPLACE FUNCTION trg_policy_immutability_fn() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Deleção física de políticas de faturamento é proibida. Utilize o cancelamento (status = canceled).';
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.status = 'canceled' THEN
            RAISE EXCEPTION 'Não é possível alterar uma política cancelada.';
        END IF;
        
        IF NEW.status = 'canceled' THEN
            IF OLD.status <> 'active' THEN
                RAISE EXCEPTION 'Apenas políticas ativas podem ser canceladas.';
            END IF;
        ELSE
            IF NEW.tenant_id <> OLD.tenant_id OR NEW.member_id <> OLD.member_id OR NEW.billing_type <> OLD.billing_type OR NEW.valid_from <> OLD.valid_from THEN
                RAISE EXCEPTION 'Campos imutáveis da política foram alterados.';
            END IF;
            IF OLD.valid_until IS NOT NULL AND (NEW.valid_until IS NULL OR NEW.valid_until > OLD.valid_until) THEN
                RAISE EXCEPTION 'A validade (valid_until) só pode ser reduzida.';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_policy_immutability
BEFORE UPDATE OR DELETE ON therapy_group_member_billing_policies
FOR EACH ROW EXECUTE FUNCTION trg_policy_immutability_fn();

CREATE OR REPLACE FUNCTION trg_prevent_void_upfront_ledger_fn() RETURNS TRIGGER AS $$
DECLARE
    found_refund BOOLEAN := FALSE;
BEGIN
    IF OLD.status = 'confirmed' AND NEW.status = 'voided' THEN
        IF EXISTS (
            SELECT 1 FROM therapy_group_member_billing_policies 
            WHERE upfront_payment_id = NEW.id
        ) THEN
            UPDATE upfront_refunds
            SET status = 'completed', completed_at = NOW()
            WHERE payment_id = NEW.id AND status = 'pending';
            
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Não é permitido estornar um pagamento associado a uma política upfront sem uma autorização pendente em upfront_refunds na mesma transação.';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_void_upfront_ledger
BEFORE UPDATE ON financial_payments
FOR EACH ROW EXECUTE FUNCTION trg_prevent_void_upfront_ledger_fn();
