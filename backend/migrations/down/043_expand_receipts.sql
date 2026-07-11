-- Down Migration: 043_expand_receipts.sql

DROP TABLE IF EXISTS audit_logs;

ALTER TABLE psychotherapy_receipts DROP CONSTRAINT IF EXISTS fk_receipt_payment_tenant;

ALTER TABLE psychotherapy_receipts DROP COLUMN IF EXISTS snapshot_version;
ALTER TABLE psychotherapy_receipts DROP COLUMN IF EXISTS service_modality;
ALTER TABLE psychotherapy_receipts DROP COLUMN IF EXISTS payment_date;
ALTER TABLE psychotherapy_receipts DROP COLUMN IF EXISTS responsible_document;
ALTER TABLE psychotherapy_receipts DROP COLUMN IF EXISTS responsible_name;
ALTER TABLE psychotherapy_receipts DROP COLUMN IF EXISTS beneficiary_document;
ALTER TABLE psychotherapy_receipts DROP COLUMN IF EXISTS beneficiary_name;
ALTER TABLE psychotherapy_receipts DROP COLUMN IF EXISTS provider_address;
ALTER TABLE psychotherapy_receipts DROP COLUMN IF EXISTS provider_professional_id;
ALTER TABLE psychotherapy_receipts DROP COLUMN IF EXISTS provider_document;
ALTER TABLE psychotherapy_receipts DROP COLUMN IF EXISTS provider_name;
ALTER TABLE psychotherapy_receipts DROP COLUMN IF EXISTS cancellation_reason;
ALTER TABLE psychotherapy_receipts DROP COLUMN IF EXISTS canceled_by;
ALTER TABLE psychotherapy_receipts DROP COLUMN IF EXISTS canceled_at;
ALTER TABLE psychotherapy_receipts DROP COLUMN IF EXISTS is_legacy;
ALTER TABLE psychotherapy_receipts DROP COLUMN IF EXISTS status;
ALTER TABLE psychotherapy_receipts DROP COLUMN IF EXISTS payment_id;
