-- Migration: 024_tenant_admin_and_preview.sql
-- Descrição: Adiciona coluna is_admin na tabela de tenants e define o admin inicial
-- Criado em: 2026-06-11

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
UPDATE tenants SET is_admin = TRUE WHERE email = 'rodrigosonsino@gmail.com';
