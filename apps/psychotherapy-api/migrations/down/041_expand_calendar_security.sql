-- Down Migration: 041_expand_calendar_security.sql

ALTER TABLE auth_refresh_tokens DROP COLUMN IF EXISTS replaced_by_id;
ALTER TABLE auth_refresh_tokens DROP COLUMN IF EXISTS parent_id;
ALTER TABLE auth_refresh_tokens DROP COLUMN IF EXISTS family_id;
ALTER TABLE therapy_group_members DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE psychotherapy_appointments DROP COLUMN IF EXISTS calendar_event_id;
ALTER TABLE psychotherapy_patients DROP COLUMN IF EXISTS deleted_at;

DROP TABLE IF EXISTS google_oauth_states;
DROP TABLE IF EXISTS failed_totp_attempts;
DROP TABLE IF EXISTS two_factor_challenges;
DROP TABLE IF EXISTS calendar_events;
DROP TABLE IF EXISTS data_migrations;
