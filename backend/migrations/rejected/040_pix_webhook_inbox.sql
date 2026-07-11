-- Migration: 040_pix_webhook_inbox.sql
-- Descrição: Criação da tabela de Inbox transacional para webhook do Pix da Efí Bank.

CREATE TABLE IF NOT EXISTS pix_webhook_inbox (
  end_to_end_id VARCHAR(100) PRIMARY KEY,
  txid VARCHAR(100) NOT NULL,
  amount_cents INTEGER NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pix_webhook_inbox_txid ON pix_webhook_inbox(txid);
