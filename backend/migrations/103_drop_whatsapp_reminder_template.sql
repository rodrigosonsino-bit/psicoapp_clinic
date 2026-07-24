BEGIN;

ALTER TABLE tenants DROP COLUMN whatsapp_reminder_template;

COMMIT;
