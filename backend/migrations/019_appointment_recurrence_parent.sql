ALTER TABLE psychotherapy_appointments
    ADD COLUMN IF NOT EXISTS parent_id UUID
        REFERENCES psychotherapy_appointments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_psychotherapy_appt_parent
    ON psychotherapy_appointments(parent_id)
    WHERE parent_id IS NOT NULL;
