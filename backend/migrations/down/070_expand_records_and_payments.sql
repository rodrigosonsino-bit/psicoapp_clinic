-- down/070_expand_records_and_payments.sql

ALTER TABLE group_payments DROP COLUMN IF EXISTS charge_type;
ALTER TABLE group_payments DROP CONSTRAINT IF EXISTS fk_group_payments_member;
ALTER TABLE group_session_records DROP CONSTRAINT IF EXISTS fk_group_session_records_member;
ALTER TABLE group_payments DROP COLUMN IF EXISTS group_member_id;
ALTER TABLE group_session_records DROP COLUMN IF EXISTS group_member_id;
