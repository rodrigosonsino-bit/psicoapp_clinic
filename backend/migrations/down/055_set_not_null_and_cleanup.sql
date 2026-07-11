-- Down Migration: 055_set_not_null_and_cleanup.sql

ALTER TABLE auth_refresh_tokens ALTER COLUMN family_id DROP NOT NULL;
ALTER TABLE therapy_group_members ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE psychotherapy_appointments ALTER COLUMN calendar_event_id DROP NOT NULL;
