-- Down Migration: 063_whatsapp_cloud_pilot.sql

DROP INDEX IF EXISTS uq_whatsapp_template_active_purpose;
DROP TABLE IF EXISTS whatsapp_cloud_templates;

DROP INDEX IF EXISTS idx_whatsapp_webhook_unprocessed;
DROP INDEX IF EXISTS uq_whatsapp_webhook_status_event;
DROP TABLE IF EXISTS whatsapp_cloud_webhook_events;

DROP TABLE IF EXISTS psychotherapy_whatsapp_cloud_status;

DROP INDEX IF EXISTS idx_whatsapp_cloud_attempts_appointment;
DROP TABLE IF EXISTS psychotherapy_whatsapp_cloud_attempts;

ALTER TABLE psychotherapy_reminders_log
    DROP COLUMN IF EXISTS provider,
    DROP COLUMN IF EXISTS retry_eligible;
