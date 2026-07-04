-- Migration: 081_fixed_expenses_unique_idx.sql
-- Descrição: Corrige race condition confirmada em checkAndInstantiateFixedExpenses
--   (auditoria 03/07/2026, revisão Codex CLI): a rotina fazia SELECT (expenseExistsForMonth)
--   seguido de INSERT (saveExpense) sem transação/lock, e saveExpense sempre insere com um
--   id UUID novo (ON CONFLICT (id) DO UPDATE nunca colide) — duas requests concorrentes
--   (2 abas, polling duplo do dashboard) podiam criar 2 despesas para a mesma
--   (tenant, despesa fixa, mês).
--
-- Preflight abortivo (mesmo padrão da migration 062): NUNCA saneia duplicatas
-- automaticamente. Se já existirem, o DBA precisa reconciliar manualmente (decidir qual
-- linha é a "real" e anular/excluir a outra) antes de reaplicar esta migration.
--
-- migrate:transaction=false
-- (CREATE INDEX CONCURRENTLY não pode rodar dentro de transação; o preflight abaixo roda
-- como statement avulso antes do índice, sem prejuízo — se abortar, nada foi criado ainda.)

DO $$
DECLARE
  cnt INT;
BEGIN
  SELECT COUNT(*) INTO cnt FROM (
    SELECT tenant_id, fixed_expense_id, reference_month
    FROM psychotherapy_expenses
    WHERE fixed_expense_id IS NOT NULL
    GROUP BY tenant_id, fixed_expense_id, reference_month
    HAVING COUNT(*) > 1
  ) t;

  IF cnt > 0 THEN
    RAISE EXCEPTION
      'BLOQUEIO: % combinação(ões) de despesa fixa duplicada (mesma tenant/despesa fixa/mês). '
      'Reconciliação manual obrigatória antes de continuar — decidir qual linha manter e '
      'excluir a(s) outra(s). Query de diagnóstico: '
      'SELECT tenant_id, fixed_expense_id, reference_month, COUNT(*), array_agg(id) '
      'FROM psychotherapy_expenses WHERE fixed_expense_id IS NOT NULL '
      'GROUP BY tenant_id, fixed_expense_id, reference_month HAVING COUNT(*) > 1;',
      cnt;
  END IF;
END;
$$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_psychotherapy_expenses_fixed_month
ON psychotherapy_expenses(tenant_id, fixed_expense_id, reference_month)
WHERE fixed_expense_id IS NOT NULL;
