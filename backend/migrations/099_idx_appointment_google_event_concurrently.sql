-- migrate:transaction=false
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_appointment_google_event
ON psychotherapy_appointments (tenant_id, google_event_id)
WHERE google_event_id IS NOT NULL AND btrim(google_event_id) <> '';
