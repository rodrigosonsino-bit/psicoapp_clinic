-- Migration: 085_add_monthly_recurrence_type.sql
-- Descrição: Adiciona 'monthly' ao enum recurrence_type, pra suportar agendamentos
-- recorrentes mensais (1x por mês), além dos já existentes 'weekly'/'biweekly'.
-- Não referencia o novo valor nesta mesma transação (só o adiciona ao tipo) — seguro
-- rodar dentro de transação desde o Postgres 12.
--
-- Runner gerencia a transação — NÃO incluir BEGIN/COMMIT aqui.

ALTER TYPE recurrence_type ADD VALUE IF NOT EXISTS 'monthly';
