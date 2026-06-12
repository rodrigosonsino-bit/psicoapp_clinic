-- Migration: 014_whatsapp_integration.sql
-- Descrição: Tabelas necessárias para integração WhatsApp via Baileys
-- Criado em: 2026-06-05

-- ── whatsapp_connected no tenants ─────────────────────────────────────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS whatsapp_connected BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Armazenamento de credenciais do Baileys (multi-tenant) ────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_auth (
    tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key         VARCHAR(255) NOT NULL,
    value       JSONB       NOT NULL,
    PRIMARY KEY (tenant_id, key)
);

-- ── Contatos sincronizados do WhatsApp ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_contacts (
    tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    id          VARCHAR(255) NOT NULL,
    name        VARCHAR(255) NOT NULL,
    ai_disabled BOOLEAN     NOT NULL DEFAULT FALSE,
    ai_disabled_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_tenant ON whatsapp_contacts(tenant_id);
