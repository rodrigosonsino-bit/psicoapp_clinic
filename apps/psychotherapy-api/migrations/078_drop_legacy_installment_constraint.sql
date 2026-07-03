-- 078_drop_legacy_installment_constraint.sql

DO $$ 
DECLARE
    idx RECORD;
    invalid_indexes TEXT := '';
BEGIN
    FOR idx IN 
        SELECT indexrelid::regclass::text AS index_name, indisvalid, indisready
        FROM pg_index
        WHERE indexrelid::regclass::text IN (
            'uq_group_payments_monthly_active',
            'uq_group_payments_session_active',
            'uq_group_payments_upfront_active'
        )
    LOOP
        IF NOT idx.indisvalid OR NOT idx.indisready THEN
            invalid_indexes := invalid_indexes || idx.index_name || ' ';
        END IF;
    END LOOP;

    IF invalid_indexes <> '' THEN
        RAISE EXCEPTION 'Índices inválidos ou não prontos: %. Abortando DROP CONSTRAINT.', invalid_indexes;
    END IF;

    -- Se todos os índices estiverem válidos (ou não houver falha, o que indica que já foram validados e criados na migration anterior)
    -- NOTA: O PG não aborta se não achar o índice no loop, mas assumimos que a migration concorrente rodou.
    -- Para maior rigor, podemos exigir a contagem = 3.
    IF (SELECT COUNT(*) FROM pg_index WHERE indexrelid::regclass::text IN (
            'uq_group_payments_monthly_active',
            'uq_group_payments_session_active',
            'uq_group_payments_upfront_active'
        )) < 3 THEN
        RAISE EXCEPTION 'Faltam índices de group_payments. Abortando DROP CONSTRAINT.';
    END IF;

END $$;

ALTER TABLE group_payments DROP CONSTRAINT IF EXISTS uq_group_payment_installment;
