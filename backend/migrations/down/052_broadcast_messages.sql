-- Rollback: 052_broadcast_messages.sql

DROP TABLE IF EXISTS psychotherapy_broadcast_recipients;
DROP TABLE IF EXISTS psychotherapy_broadcasts;

ALTER TABLE psychotherapy_patients DROP COLUMN IF EXISTS whatsapp_bulk_opt_out_at;
ALTER TABLE psychotherapy_patients DROP COLUMN IF EXISTS whatsapp_bulk_opt_in_at;
ALTER TABLE psychotherapy_patients DROP COLUMN IF EXISTS whatsapp_bulk_opt_in;
