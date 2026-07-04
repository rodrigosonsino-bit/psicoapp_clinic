-- Down: 083_appointment_session_link_idx_concurrently.sql
-- migrate:transaction=false

DROP INDEX CONCURRENTLY IF EXISTS uq_psychotherapy_sessions_appointment;
