-- migrate:transaction=false
-- Migration: 081_fixed_expenses_unique_idx.sql
-- noTransaction
--
-- Descrição: Corrige race condition confirmada em checkAndInstantiateFixedExpenses
--   (auditoria 03/07/2026, revisão Codex CLI): a rotina fazia SELECT (expenseExistsForMonth)
--   seguido de INSERT (saveExpense) sem transação/lock, e saveExpense sempre insere com um
--   id UUID novo (ON CONFLICT (id) DO UPDATE nunca colide) — duas requests concorrentes
--   (2 abas, polling duplo do dashboard) podiam criar 2 despesas para a mesma
--   (tenant, despesa fixa, mês).
--
-- Se já existirem duplicatas hoje, este CREATE UNIQUE INDEX falha naturalmente com erro
-- do Postgres ("could not create unique index ... is duplicated") — não tenta saneá-las
-- automaticamente. Reconciliação manual seria necessária antes de reaplicar.
--
-- NOTA: uma versão anterior deste arquivo combinava um bloco de preflight (DO $$...$$)
-- com este CREATE INDEX CONCURRENTLY no mesmo arquivo. O runner executa o conteúdo do
-- arquivo inteiro numa única chamada client.query(sql) — e o protocolo do Postgres trata
-- múltiplos statements enviados de uma vez como uma transação implícita, mesmo sem BEGIN
-- explícito, o que quebra CONCURRENTLY ("cannot run inside a transaction block"). Corrigido
-- deixando este arquivo com um único statement.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_psychotherapy_expenses_fixed_month
ON psychotherapy_expenses(tenant_id, fixed_expense_id, reference_month)
WHERE fixed_expense_id IS NOT NULL;
