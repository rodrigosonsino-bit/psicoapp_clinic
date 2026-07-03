-- Migration: 039_google_oauth_states.sql
-- Descrição: Criação da tabela para gerenciamento de states seguros de login do Google.

CREATE TABLE IF NOT EXISTS google_oauth_states (
  state_hash CHAR(64) PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  redirect_uri TEXT,
  pkce_verifier TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_google_oauth_states_expiry 
  ON google_oauth_states(expires_at) 
  WHERE consumed_at IS NULL;
