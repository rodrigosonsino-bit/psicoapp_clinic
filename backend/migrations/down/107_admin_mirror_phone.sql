-- Down migration: 107_admin_mirror_phone.sql
-- ATENÇÃO: só rodar depois que o código que lê admin_mirror_phone já tiver sido
-- revertido/desligado em produção — rodar isto com o código novo ainda ativo quebra as
-- queries que esperam esta coluna.

ALTER TABLE tenants DROP COLUMN IF EXISTS admin_mirror_phone;
