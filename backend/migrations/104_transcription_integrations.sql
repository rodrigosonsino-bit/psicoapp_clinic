CREATE TABLE transcription_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL CHECK (provider IN ('deepgram_web', 'google_meet_native')),
    status VARCHAR(50) NOT NULL CHECK (status IN ('pending_consent', 'active', 'revoked', 'error')),
    google_account_id VARCHAR(255),
    scopes_granted TEXT[],
    enabled_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, provider)
);

CREATE TABLE transcription_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    appointment_id UUID NOT NULL REFERENCES psychotherapy_appointments(id) ON DELETE CASCADE,
    integration_id UUID NOT NULL REFERENCES transcription_integrations(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'waiting_artifact', 'processing', 'completed', 'failed', 'abandoned')),
    meet_space_name VARCHAR(255),
    external_transcript_id VARCHAR(255),
    draft_note_id UUID,
    attempt_count INT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at TIMESTAMPTZ,
    last_error_code VARCHAR(255),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    locked_at TIMESTAMPTZ,
    lease_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, provider, external_transcript_id)
);

CREATE UNIQUE INDEX uq_transcription_job_active 
ON transcription_jobs (tenant_id, appointment_id) 
WHERE status IN ('pending', 'waiting_artifact', 'processing');

CREATE INDEX idx_transcription_jobs_status_next ON transcription_jobs(status, next_attempt_at);

ALTER TABLE psychotherapy_appointments ADD COLUMN meet_space_name VARCHAR(255);
