-- Migration: 086_add_monthly_status_to_patients.sql
-- Descrição: Adiciona 'monthly' aos valores válidos de status em psychotherapy_patients
-- E psychotherapy_monthly_records (o snapshot de status gravado no registro mensal tem
-- sua própria constraint idêntica — descoberto ao testar: salvar um paciente com
-- status='monthly' sincroniza o registro do mês corrente, que falhava na constraint
-- da outra tabela). Pra pacientes com sessões avulsas de cadência mensal (1x por mês,
-- sem dia fixo). Complementa a migration 085 (recurrence_type de agendamentos).
-- Achado real: Rosa (2026-07-06), que passou a fazer sessões avulsas mensais em vez
-- de semanais.
--
-- Runner gerencia a transação — NÃO incluir BEGIN/COMMIT aqui.

ALTER TABLE psychotherapy_patients DROP CONSTRAINT IF EXISTS psychotherapy_patients_status_check;

ALTER TABLE psychotherapy_patients ADD CONSTRAINT psychotherapy_patients_status_check
    CHECK (status IN ('weekly', 'biweekly', 'monthly', 'one_off', 'inactive'));

ALTER TABLE psychotherapy_monthly_records DROP CONSTRAINT IF EXISTS psychotherapy_monthly_records_status_check;

ALTER TABLE psychotherapy_monthly_records ADD CONSTRAINT psychotherapy_monthly_records_status_check
    CHECK (status IN ('weekly', 'biweekly', 'monthly', 'one_off', 'inactive'));
