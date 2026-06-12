-- Migration: 023_sarah_p0_features.sql
-- Descrição: Criação da tabela de perfis de contatos temporários da Sarah no WhatsApp
-- Criado em: 2026-06-11

CREATE TABLE IF NOT EXISTS sarah_patient_profiles (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contact_jid    VARCHAR(255) NOT NULL,
    full_name      VARCHAR(255),
    phone          VARCHAR(50),
    city           VARCHAR(100),
    modality       VARCHAR(20) CHECK (modality IN ('online', 'presencial')),
    session_type   VARCHAR(20) CHECK (session_type IN ('psicoterapia', 'pastoral')),
    referral       TEXT,
    first_contact  DATE DEFAULT CURRENT_DATE,
    last_contact   DATE DEFAULT CURRENT_DATE,
    total_sessions INT DEFAULT 0,
    notes          TEXT,
    status         VARCHAR(20) DEFAULT 'prospect' CHECK (status IN ('prospect', 'active', 'inactive')),
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_sarah_patient_profile UNIQUE(tenant_id, contact_jid)
);

CREATE INDEX IF NOT EXISTS idx_sarah_patient_profiles_tenant ON sarah_patient_profiles(tenant_id);
