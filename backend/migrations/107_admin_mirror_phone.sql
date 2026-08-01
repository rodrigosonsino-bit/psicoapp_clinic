-- Migration: 107_admin_mirror_phone.sql

ALTER TABLE tenants ADD COLUMN admin_mirror_phone VARCHAR(20);
