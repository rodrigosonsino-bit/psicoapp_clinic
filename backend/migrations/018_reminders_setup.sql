-- Migration: 018_reminders_setup.sql
-- Descrição: Canal de lembrete por paciente + log de disparos para deduplicação

-- ── Canal de lembrete ─────────────────────────────────────────────────────────
-- Adiciona preferência de canal por paciente.
-- 'whatsapp' → padrão (mantém comportamento atual)
-- 'email'    → apenas email (requer reminder_channel = 'email' e RESEND_API_KEY)
-- 'both'     → WhatsApp + email (independentes)
-- 'none'     → não recebe lembretes automáticos

ALTER TABLE psychotherapy_patients
    ADD COLUMN IF NOT EXISTS reminder_channel VARCHAR(20) NOT NULL DEFAULT 'whatsapp'
        CHECK (reminder_channel IN ('whatsapp', 'email', 'both', 'none'));

-- ── Log de lembretes disparados ───────────────────────────────────────────────
-- Garante idempotência: o scheduler verifica se já existe um registro 'success'
-- para o par (appointment_id, channel_used) antes de disparar.

CREATE TABLE IF NOT EXISTS psychotherapy_reminders_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    appointment_id  UUID NOT NULL REFERENCES psychotherapy_appointments(id) ON DELETE CASCADE,
    channel_used    VARCHAR(20) NOT NULL CHECK (channel_used IN ('whatsapp', 'email')),
    status          VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failed')),
    error_message   TEXT,
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminders_log_appointment
    ON psychotherapy_reminders_log(appointment_id, channel_used, status);
CREATE INDEX IF NOT EXISTS idx_reminders_log_tenant_sent_at
    ON psychotherapy_reminders_log(tenant_id, sent_at DESC);
