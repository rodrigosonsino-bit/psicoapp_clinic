-- Migration: 012_google_calendar.sql
-- Descrição: Suporte a Google Calendar por tenant e link de confirmação por agendamento

-- Tokens OAuth2 do Google por tenant
CREATE TABLE IF NOT EXISTS google_oauth_tokens (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expiry_date BIGINT,           -- milissegundos epoch
    calendar_id TEXT,             -- ID do calendário Sessões_Terapia encontrado/criado
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Adiciona colunas ao agendamento para rastrear o evento do Google Calendar
ALTER TABLE psychotherapy_appointments
    ADD COLUMN IF NOT EXISTS google_event_id TEXT,
    ADD COLUMN IF NOT EXISTS google_event_url TEXT,
    ADD COLUMN IF NOT EXISTS confirm_token UUID UNIQUE DEFAULT gen_random_uuid(),
    ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_appointments_confirm_token ON psychotherapy_appointments(confirm_token);
