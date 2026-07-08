-- Migration: 088_whatsapp_messages_history.sql
-- Descrição: Histórico de conversa WhatsApp por paciente (visualização apenas, sem automação).
-- Expand-only: não altera nenhuma tabela existente (063/087/psychotherapy_patients).

-- Append-only, mesmo padrão estrutural de psychotherapy_clinical_notes (migration 009):
-- tenant_id/patient_id, indexado por data. UNIQUE(provider_message_id) evita duplicar linha se o
-- worker/reminder reprocessar o mesmo wamid (mesma lógica de dedup das tabelas 063/087).
CREATE TABLE IF NOT EXISTS psychotherapy_whatsapp_messages (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    patient_id             UUID NOT NULL REFERENCES psychotherapy_patients(id) ON DELETE CASCADE,
    direction              VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    provider_message_id    VARCHAR(100) NOT NULL UNIQUE,
    body                   TEXT NOT NULL,
    message_type           VARCHAR(20) NOT NULL DEFAULT 'text',
    occurred_at            TIMESTAMPTZ NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_patient_timeline
    ON psychotherapy_whatsapp_messages (tenant_id, patient_id, occurred_at DESC);
