-- Migration: 044_pix_webhook_inbox.sql
-- Descrição: Criação da tabela pix_webhook_inbox para controle fail-closed de webhooks Pix.

CREATE TABLE IF NOT EXISTS pix_webhook_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key VARCHAR(255) UNIQUE,
  txid VARCHAR(100) NOT NULL,
  end_to_end_id VARCHAR(100),
  payload JSONB NOT NULL,
  status VARCHAR(50) NOT NULL CHECK (status IN ('received', 'processing', 'processed', 'failed', 'manual_review')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  lock_token VARCHAR(100),
  locked_until TIMESTAMPTZ,
  last_error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);
