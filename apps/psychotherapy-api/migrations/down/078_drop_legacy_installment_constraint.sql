-- down/078_drop_legacy_installment_constraint.sql

-- A constraint legada uq_group_payment_installment não será recriada automaticamente.
-- As regras de negócio foram movidas para índices parciais (072, 073, 074).
