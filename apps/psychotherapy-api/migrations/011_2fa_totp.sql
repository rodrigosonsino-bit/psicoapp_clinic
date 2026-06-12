-- Migration: 011_2fa_totp.sql
-- Descrição: Campos de autenticação 2FA (TOTP) na tabela de tenants

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS totp_secret TEXT,
    ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS totp_backup_codes TEXT[];
