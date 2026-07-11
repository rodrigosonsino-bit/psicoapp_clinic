-- Down: 082_appointment_session_link.sql
-- Reverte apenas o esquema. O backfill de appointment_id é recalculável a qualquer momento
-- (é derivado, não é dado primário) — não há perda de informação em reverter, exceto pelos
-- casos que só puderam ser ligados manualmente/heuristicamente depois da migration original
-- e não seriam re-derivados automaticamente. Dropar a coluna também remove a FK e o índice
-- (083) automaticamente por cascata.

ALTER TABLE psychotherapy_sessions DROP COLUMN IF EXISTS appointment_id;
