-- Migration: 089_whatsapp_messages_seen_at.sql
-- Descrição: Rastreia se uma mensagem inbound já foi vista pelo profissional, para o popup
-- global de conversa nova. Expand-only: não altera comportamento existente.

-- NULL = mensagem inbound ainda não vista. Outbound não usa esta coluna (sempre NULL, ignorado).
ALTER TABLE psychotherapy_whatsapp_messages
    ADD COLUMN IF NOT EXISTS seen_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_unseen
    ON psychotherapy_whatsapp_messages (tenant_id, patient_id, occurred_at DESC)
    WHERE direction = 'inbound' AND seen_at IS NULL;
