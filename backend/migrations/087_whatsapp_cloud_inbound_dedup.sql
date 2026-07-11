-- Migration: 087_whatsapp_cloud_inbound_dedup.sql
-- Descrição: Dedup para mensagens inbound (event_type='message') da WhatsApp Cloud API.
-- Escopo mínimo: apenas encaminhamento de notificação (sem automação/resposta ao paciente).
-- Expand-only: não altera nada existente da migration 063.

-- Sem isso, o mesmo wamid inbound poderia gerar duas linhas na inbox se a Meta reentregar o
-- webhook (at-least-once) antes do ack — resultando em notificação duplicada para o número
-- pessoal. Mesma lógica de dedup já usada para event_type='status' (migration 063).
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_webhook_message_event
    ON whatsapp_cloud_webhook_events (provider_message_id)
    WHERE event_type = 'message';
