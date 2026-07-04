-- Migration: 082_appointment_session_link.sql
-- Descrição: Corrige integridade appointment/session (item 6 do plano pós-Codex, achado na
--   revisão de 03/07/2026 + revisão de 04/07/2026 desta própria implementação — REPROVADA na
--   primeira tentativa, corrigida aqui). Ver histórico completo no NotebookLM do projeto.
--
-- Correções desta versão vs. a reprovada:
--   1. FK composta (appointment_id, tenant_id) em vez de só appointment_id — a versão anterior
--      permitia uma sessão do tenant A apontar pra um agendamento do tenant B.
--   2. Backfill agora exige unicidade nos DOIS sentidos (1 sessão -> 1 agendamento E 1
--      agendamento -> 1 sessão). A versão anterior só checava o lado da sessão: se 2 sessões
--      (S1, S2) do mesmo tenant/paciente/data batessem com o MESMO único agendamento A1, as
--      duas recebiam appointment_id=A1 — violando a unicidade que a migration 083 tentaria
--      impor depois, quebrando o boot (mesma classe do incidente de produção desta sessão).
--   3. Sem ON DELETE SET NULL na FK (evitaria zerar tenant_id, que é NOT NULL, numa FK
--      composta). A aplicação (deleteAppointment) agora limpa appointment_id explicitamente
--      antes de excluir o agendamento, quando a sessão precisa ser preservada (tem nota
--      clínica).
--
-- Runner gerencia a transação — NÃO incluir BEGIN/COMMIT aqui.

ALTER TABLE psychotherapy_sessions
  ADD COLUMN IF NOT EXISTS appointment_id UUID;

ALTER TABLE psychotherapy_sessions
  ADD CONSTRAINT fk_psychotherapy_sessions_appointment
  FOREIGN KEY (appointment_id, tenant_id)
  REFERENCES psychotherapy_appointments(id, tenant_id);

-- Backfill: liga sessões existentes ao agendamento correspondente por (tenant, paciente, data),
-- SOMENTE quando o match é inequívoco NOS DOIS SENTIDOS: a sessão tem exatamente 1 agendamento
-- candidato E esse agendamento tem exatamente 1 sessão candidata. Qualquer ambiguidade de
-- qualquer um dos lados deixa appointment_id NULL — não é erro, só não é rastreável
-- automaticamente (reconciliação manual fica pra depois, se necessário).
--
-- Comparação de data explícita em UTC (achado da 2ª revisão, 04/07/2026): psychotherapy_sessions
-- .date é TIMESTAMP WITHOUT TIME ZONE e psychotherapy_appointments.scheduled_at é TIMESTAMPTZ —
-- comparar os dois diretamente depende do TimeZone da conexão que roda a migration, podendo
-- variar entre ambientes. `s.date AT TIME ZONE 'UTC'` reinterpreta o valor naive como UTC
-- explicitamente (mesma convenção usada pelo driver pg ao serializar Date do Node), tornando o
-- backfill determinístico independente da sessão. Não corrige a divergência de tipo em si
-- (fica pra uma migration futura, mudança maior) — só remove a ambiguidade deste backfill.
WITH candidate_matches AS (
    SELECT
        s.id AS session_id,
        a.id AS appointment_id,
        COUNT(*) OVER (PARTITION BY s.id) AS session_side_count,
        COUNT(*) OVER (PARTITION BY a.id) AS appointment_side_count
    FROM psychotherapy_sessions s
    JOIN psychotherapy_appointments a
      ON a.tenant_id = s.tenant_id
     AND a.patient_id = s.patient_id
     AND a.scheduled_at = (s.date AT TIME ZONE 'UTC')
    WHERE s.appointment_id IS NULL
)
UPDATE psychotherapy_sessions s
SET appointment_id = cm.appointment_id
FROM candidate_matches cm
WHERE cm.session_id = s.id
  AND cm.session_side_count = 1
  AND cm.appointment_side_count = 1;
