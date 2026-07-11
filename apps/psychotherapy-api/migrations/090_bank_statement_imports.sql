-- Migration: 090_bank_statement_imports.sql
-- Descrição: Conciliação de extrato bancário (CSV Nubank) -> baixa de sessões
-- pagas no Faturamento Mensal individual. Ver docs/bank-statement-reconciliation-plan.md.
-- Tabelas novas e isoladas — não altera nenhum schema existente.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TABLE psychotherapy_bank_statement_imports (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id),
  file_name             VARCHAR(255) NOT NULL,
  file_format           VARCHAR(10) NOT NULL CHECK (file_format IN ('csv')),
  period_start          DATE,
  period_end            DATE,
  transaction_count     INT NOT NULL DEFAULT 0,
  skipped_line_count    INT NOT NULL DEFAULT 0,
  duplicate_fitid_count INT NOT NULL DEFAULT 0,
  imported_by           UUID NOT NULL REFERENCES tenants(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, tenant_id)
);

CREATE TABLE psychotherapy_bank_statement_transactions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id),
  import_id              UUID NOT NULL,
  -- FITID real do banco (coluna "Identificador" no CSV do Nubank),
  -- confirmado estável e único por transação com extrato real.
  fitid                  VARCHAR(100) NOT NULL,
  posted_at              DATE NOT NULL,
  amount_cents           INT NOT NULL CHECK (amount_cents > 0),
  raw_description        TEXT NOT NULL,
  payer_name_guess       VARCHAR(255),

  suggested_patient_id   UUID,
  suggested_month        CHAR(7) CHECK (suggested_month ~ '^\d{4}-\d{2}$'),
  suggested_sessions     INT CHECK (suggested_sessions IS NULL OR suggested_sessions > 0),
  match_confidence       VARCHAR(20) NOT NULL DEFAULT 'none'
                          CHECK (match_confidence IN ('high','medium','low','none')),
  possible_pix_duplicate BOOLEAN NOT NULL DEFAULT FALSE,

  status                 VARCHAR(20) NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','confirmed','ignored')),
  confirmed_patient_id    UUID,
  confirmed_month         CHAR(7) CHECK (confirmed_month ~ '^\d{4}-\d{2}$'),
  confirmed_sessions      INT CHECK (confirmed_sessions IS NULL OR confirmed_sessions > 0),
  confirmed_at            TIMESTAMPTZ,
  confirmed_by            UUID,
  ignored_at              TIMESTAMPTZ,
  ignored_by              UUID,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  FOREIGN KEY (import_id, tenant_id)
    REFERENCES psychotherapy_bank_statement_imports (id, tenant_id) ON DELETE CASCADE,
  -- RESTRICT (não SET NULL) em ambas — evita problema de FK composta com
  -- coluna NOT NULL (tenant_id) no meio do SET NULL; mesmo padrão de
  -- financial_payments.patient_id.
  FOREIGN KEY (suggested_patient_id, tenant_id)
    REFERENCES psychotherapy_patients (id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (confirmed_patient_id, tenant_id)
    REFERENCES psychotherapy_patients (id, tenant_id) ON DELETE RESTRICT,
  -- FK simples pra tenants(id), igual ao padrão já usado em
  -- financial_payments.created_by — modelo atual é 1 operador == o próprio
  -- tenant, sem tabela de usuários separada.
  FOREIGN KEY (confirmed_by) REFERENCES tenants(id),
  FOREIGN KEY (ignored_by) REFERENCES tenants(id),
  CHECK (confirmed_by IS NULL OR confirmed_by = tenant_id),
  CHECK (ignored_by IS NULL OR ignored_by = tenant_id),

  UNIQUE (tenant_id, fitid),

  -- Integridade de estado completa para as 3 combinações válidas
  CONSTRAINT bank_stmt_tx_state_integrity CHECK (
    (status = 'pending'
      AND confirmed_patient_id IS NULL AND confirmed_sessions IS NULL
      AND confirmed_month IS NULL AND confirmed_at IS NULL AND confirmed_by IS NULL
      AND ignored_at IS NULL AND ignored_by IS NULL)
    OR
    (status = 'confirmed'
      AND confirmed_patient_id IS NOT NULL AND confirmed_sessions IS NOT NULL
      AND confirmed_month IS NOT NULL AND confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL
      AND ignored_at IS NULL AND ignored_by IS NULL)
    OR
    (status = 'ignored'
      AND confirmed_patient_id IS NULL AND confirmed_sessions IS NULL AND confirmed_month IS NULL
      AND confirmed_at IS NULL AND confirmed_by IS NULL
      AND ignored_at IS NOT NULL AND ignored_by IS NOT NULL)
  )
);
