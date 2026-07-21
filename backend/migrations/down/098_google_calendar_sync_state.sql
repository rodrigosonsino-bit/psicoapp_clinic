ALTER TABLE psychotherapy_appointments
  DROP CONSTRAINT IF EXISTS ck_google_event_generation,
  DROP CONSTRAINT IF EXISTS ck_google_sync_state,
  DROP COLUMN IF EXISTS google_sync_updated_at,
  DROP COLUMN IF EXISTS google_sync_last_error,
  DROP COLUMN IF EXISTS google_sync_attempts,
  DROP COLUMN IF EXISTS google_event_generation,
  DROP COLUMN IF EXISTS google_sync_state;
