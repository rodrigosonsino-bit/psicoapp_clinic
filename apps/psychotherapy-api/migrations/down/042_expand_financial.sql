-- Down Migration: 042_expand_financial.sql

DROP TABLE IF EXISTS legacy_financial_snapshots;
DROP TABLE IF EXISTS tenant_financial_cutovers;
ALTER TABLE psychotherapy_monthly_records DROP COLUMN IF EXISTS expected_amount_cents;
DROP TABLE IF EXISTS financial_payments;

ALTER TABLE psychotherapy_monthly_records DROP CONSTRAINT IF EXISTS uq_monthly_record_tenant;
ALTER TABLE psychotherapy_patients DROP CONSTRAINT IF EXISTS uq_psychotherapy_patient_tenant;
