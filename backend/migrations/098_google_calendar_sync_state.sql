ALTER TABLE psychotherapy_appointments
  ADD COLUMN IF NOT EXISTS google_sync_state TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS google_event_generation INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS google_sync_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS google_sync_last_error TEXT,
  ADD COLUMN IF NOT EXISTS google_sync_updated_at TIMESTAMPTZ;

ALTER TABLE psychotherapy_appointments
  DROP CONSTRAINT IF EXISTS ck_google_sync_state;

ALTER TABLE psychotherapy_appointments
  ADD CONSTRAINT ck_google_sync_state
  CHECK (google_sync_state IN ('idle', 'pending', 'processing', 'synced', 'error', 'deleted'));

ALTER TABLE psychotherapy_appointments
  DROP CONSTRAINT IF EXISTS ck_google_event_generation;

ALTER TABLE psychotherapy_appointments
  ADD CONSTRAINT ck_google_event_generation
  CHECK (google_event_generation >= 0);

UPDATE psychotherapy_appointments
SET google_sync_state = 'synced'
WHERE google_event_id IS NOT NULL
  AND btrim(google_event_id) <> '';

UPDATE psychotherapy_appointments
SET google_event_id = NULL,
    google_event_url = NULL,
    google_sync_state = CASE
      WHEN status = 'canceled' THEN 'deleted'
      ELSE 'pending'
    END,
    google_sync_updated_at = NOW()
WHERE google_event_id = '';
