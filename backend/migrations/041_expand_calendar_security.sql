-- Migration: 041_expand_calendar_security.sql
-- Descrição: Criação das tabelas de dados, calendar_events, 2FA, failed TOTP, Google OAuth state e colunas nullable de transição.

-- 1. Tabela de controle de migrações de dados
CREATE TABLE IF NOT EXISTS data_migrations (
  name VARCHAR(255) PRIMARY KEY,
  status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  last_checkpoint VARCHAR(255),
  rows_processed INTEGER NOT NULL DEFAULT 0,
  checksum CHAR(64),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error TEXT
);

-- 2. Tabela calendar_events
CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('individual', 'group')),
  status VARCHAR(50) NOT NULL CHECK (status IN ('scheduled', 'confirmed', 'completed', 'canceled')),
  group_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, tenant_id),
  CHECK (ended_at > scheduled_at),
  CHECK (
    (event_type = 'individual' AND group_id IS NULL) OR
    (event_type = 'group' AND group_id IS NOT NULL)
  )
);

-- 3. Tabela two_factor_challenges
CREATE TABLE IF NOT EXISTS two_factor_challenges (
  challenge_hash CHAR(64) PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Tabela failed_totp_attempts
CREATE TABLE IF NOT EXISTS failed_totp_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ip_address INET NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Tabela google_oauth_states
CREATE TABLE IF NOT EXISTS google_oauth_states (
  state_hash CHAR(64) PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Adiciona colunas nullable temporárias
ALTER TABLE psychotherapy_patients ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE psychotherapy_appointments ADD COLUMN IF NOT EXISTS calendar_event_id UUID;
ALTER TABLE therapy_group_members ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE auth_refresh_tokens ADD COLUMN IF NOT EXISTS family_id UUID;
ALTER TABLE auth_refresh_tokens ADD COLUMN IF NOT EXISTS parent_id UUID;
ALTER TABLE auth_refresh_tokens ADD COLUMN IF NOT EXISTS replaced_by_id UUID;
