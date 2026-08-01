BEGIN;

DROP TABLE IF EXISTS billing_reminders_log;

ALTER TABLE psychotherapy_patients DROP COLUMN IF EXISTS automatic_billing_opt_out;

ALTER TABLE tenants DROP COLUMN IF EXISTS automatic_billing_reminders;

COMMIT;
