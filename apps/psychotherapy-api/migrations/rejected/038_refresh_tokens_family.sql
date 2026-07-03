-- Migration: 038_refresh_tokens_family.sql
-- Descrição: Adiciona colunas para controle de rotação e família de refresh tokens.

ALTER TABLE auth_refresh_tokens
  ADD COLUMN IF NOT EXISTS family_id UUID,
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES auth_refresh_tokens(id),
  ADD COLUMN IF NOT EXISTS replaced_by_id UUID REFERENCES auth_refresh_tokens(id);

UPDATE auth_refresh_tokens SET family_id = id WHERE family_id IS NULL;
ALTER TABLE auth_refresh_tokens ALTER COLUMN family_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_refresh_family ON auth_refresh_tokens(family_id);
