-- Down 097_add_missing_receipt_snapshot_columns.sql

ALTER TABLE psychotherapy_receipts DROP COLUMN IF EXISTS patient_name_snapshot;
ALTER TABLE psychotherapy_receipts DROP COLUMN IF EXISTS patient_document_snapshot;
ALTER TABLE psychotherapy_receipts DROP COLUMN IF EXISTS tenant_name_snapshot;
ALTER TABLE psychotherapy_receipts DROP COLUMN IF EXISTS tenant_document_snapshot;
ALTER TABLE psychotherapy_receipts DROP COLUMN IF EXISTS tenant_professional_id_snapshot;
ALTER TABLE psychotherapy_receipts DROP COLUMN IF EXISTS tenant_address_snapshot;
