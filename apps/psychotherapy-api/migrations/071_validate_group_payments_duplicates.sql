-- 071_validate_group_payments_duplicates.sql

ALTER TABLE group_payments ADD CONSTRAINT chk_group_payments_charge_type 
CHECK ((charge_type = 'session' AND group_session_record_id IS NOT NULL) OR 
       (charge_type IN ('monthly', 'course_upfront') AND group_session_record_id IS NULL)) NOT VALID;
       
ALTER TABLE group_payments VALIDATE CONSTRAINT chk_group_payments_charge_type;

DO $$ 
BEGIN
    -- Validação de duplicatas de mensalidade (ignorando voided)
    IF EXISTS (
        SELECT 1
        FROM group_payments
        WHERE charge_type = 'monthly' AND status <> 'voided'
        GROUP BY tenant_id, group_member_id, reference_month
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Duplicatas de mensalidade ativas encontradas. Reconcilie o faturamento antes de aplicar as migrations.';
    END IF;

    -- Validação de duplicatas de sessão
    IF EXISTS (
        SELECT 1
        FROM group_payments
        WHERE charge_type = 'session' AND status <> 'voided'
        GROUP BY tenant_id, group_session_record_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Duplicatas de sessão ativas encontradas. Reconcilie o faturamento antes de aplicar as migrations.';
    END IF;

    -- Validação de duplicatas upfront (embora recém-criado o tipo, validamos por completeza)
    IF EXISTS (
        SELECT 1
        FROM group_payments
        WHERE charge_type = 'course_upfront' AND status <> 'voided'
        GROUP BY tenant_id, group_member_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Duplicatas de curso upfront ativas encontradas. Reconcilie o faturamento antes de aplicar as migrations.';
    END IF;
END $$;
