-- Down migration for 038_refresh_tokens_family.sql

DROP INDEX IF EXISTS idx_refresh_family;
ALTER TABLE auth_refresh_tokens DROP COLUMN IF EXISTS replaced_by_id;
ALTER TABLE auth_refresh_tokens DROP COLUMN IF EXISTS parent_id;
ALTER TABLE auth_refresh_tokens DROP COLUMN IF EXISTS family_id;
