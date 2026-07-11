-- down/071_validate_group_payments_duplicates.sql

ALTER TABLE group_payments DROP CONSTRAINT IF EXISTS chk_group_payments_charge_type;
