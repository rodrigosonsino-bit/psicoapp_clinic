-- migrate:transaction=false
-- Migration: 092_idx_pix_charges_patient_amount_active_concurrently.sql
-- noTransaction
--
-- Suporte ao gate de duplicata Pix da conciliação bancária (SELECT ... FOR
-- UPDATE por tenant+patient+amount em cobranças pending/paid) — índice
-- parcial pra evitar full scan em psychotherapy_pix_charges a cada
-- confirmação. Arquivo com um único statement (ver 091).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pix_charges_patient_amount_active
  ON psychotherapy_pix_charges (tenant_id, patient_id, amount_cents)
  WHERE status IN ('pending', 'paid');
