-- Migration: 052_broadcast_messages.sql
-- Descrição: Mensagem em massa (broadcast) para pacientes ativos com opt-in,
-- campanhas e outbox de destinatários. Ver docs/broadcast-message-plan.md.

-- 1. Consentimento explícito no paciente (default FALSE — não migra opt-in retroativo)
ALTER TABLE psychotherapy_patients ADD COLUMN IF NOT EXISTS whatsapp_bulk_opt_in BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE psychotherapy_patients ADD COLUMN IF NOT EXISTS whatsapp_bulk_opt_in_at TIMESTAMPTZ;
ALTER TABLE psychotherapy_patients ADD COLUMN IF NOT EXISTS whatsapp_bulk_opt_out_at TIMESTAMPTZ;

-- 2. Campanhas
CREATE TABLE IF NOT EXISTS psychotherapy_broadcasts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    idempotency_key UUID NOT NULL,
    content         TEXT NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 1000),
    status          VARCHAR(20) NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued', 'processing', 'completed', 'partial_failed', 'canceled')),
    total_recipients INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    canceled_at     TIMESTAMPTZ,
    UNIQUE (tenant_id, idempotency_key),
    UNIQUE (id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_psychotherapy_broadcasts_tenant_created
    ON psychotherapy_broadcasts(tenant_id, created_at DESC);

-- 3. Destinatários / outbox
CREATE TABLE IF NOT EXISTS psychotherapy_broadcast_recipients (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    broadcast_id          UUID NOT NULL,
    tenant_id             UUID NOT NULL,
    patient_id            UUID NOT NULL,
    patient_name_snapshot VARCHAR(255) NOT NULL,
    phone_snapshot        VARCHAR(20) NOT NULL,
    status                VARCHAR(20) NOT NULL DEFAULT 'queued'
                              CHECK (status IN ('queued', 'sending', 'retry_wait', 'sent', 'failed', 'delivery_unknown', 'canceled')),
    attempt_count         INT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_at             TIMESTAMPTZ,
    sent_at               TIMESTAMPTZ,
    last_error_code       VARCHAR(80),
    last_error_message    TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (broadcast_id, patient_id),
    FOREIGN KEY (broadcast_id, tenant_id) REFERENCES psychotherapy_broadcasts(id, tenant_id) ON DELETE CASCADE,
    FOREIGN KEY (patient_id, tenant_id) REFERENCES psychotherapy_patients(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_psychotherapy_broadcast_recipients_broadcast_status
    ON psychotherapy_broadcast_recipients(broadcast_id, status);

CREATE INDEX IF NOT EXISTS idx_psychotherapy_broadcast_recipients_due
    ON psychotherapy_broadcast_recipients(next_attempt_at, id)
    WHERE status IN ('queued', 'retry_wait');

CREATE INDEX IF NOT EXISTS idx_psychotherapy_broadcast_recipients_locked
    ON psychotherapy_broadcast_recipients(locked_at)
    WHERE status = 'sending';
