-- migrate:transaction=false
-- Migration: 083_appointment_session_link_idx_concurrently.sql
-- noTransaction
--
-- Índice único parcial: no máximo 1 sessão por agendamento (appointment_id não-nulo).
-- Arquivo com um ÚNICO statement de propósito — lição aprendida em 04/07/2026 (migration 081
-- original quebrou o boot em produção por combinar CREATE INDEX CONCURRENTLY com outro
-- statement no mesmo arquivo; o runner manda o arquivo inteiro numa única client.query(sql),
-- e o protocolo do Postgres trata isso como transação implícita, incompatível com CONCURRENTLY).

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_psychotherapy_sessions_appointment
ON psychotherapy_sessions(appointment_id)
WHERE appointment_id IS NOT NULL;
