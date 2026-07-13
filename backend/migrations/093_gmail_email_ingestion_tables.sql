-- Migration: 093_gmail_email_ingestion_tables.sql
-- Descrição: Ingestão automática de extrato bancário via e-mail (Gmail API),
-- fase 2 da conciliação bancária. Ver docs/email-bank-statement-ingestion-plan.md
-- (v8, aprovado após 8 rodadas de auditoria Codex CLI).
-- Tabelas novas e isoladas — não altera nenhum schema existente.

-- Conexão OAuth do Gmail, separada e dedicada da conexão do Google Calendar
-- (google_oauth_tokens) — se um token vazar, não carrega acesso ao outro.
-- Tokens cifrados via cryptoHelper.ts (mesma função já usada pro Calendar),
-- não uma cifra nova.
CREATE TABLE gmail_oauth_tokens (
  tenant_id               UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  encrypted_access_token  TEXT NOT NULL,  -- via cryptoHelper.encrypt()
  encrypted_refresh_token TEXT NOT NULL,  -- via cryptoHelper.encrypt()
  expiry_date             BIGINT NOT NULL,
  email_address           VARCHAR(255) NOT NULL, -- conta Gmail conectada (exibida na UI)
  connected_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- state do OAuth do Gmail: tabela dedicada, não reaproveita google_oauth_states
-- (que existe para o Calendar mas hoje está desconectada do fluxo real —
-- achado pré-existente, sinalizado como tarefa separada, fora deste plano).
-- Esta feature usa state aleatório de verdade desde o início.
CREATE TABLE gmail_oauth_states (
  state_hash   CHAR(64) PRIMARY KEY,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Deduplicação a nível de e-mail (separada da deduplicação por FITID já
-- existente em psychotherapy_bank_statement_transactions). claim_token
-- garante ownership real do worker durante claim/reclaim; sender_normalized
-- alimenta a tela de e-mails rejeitados.
CREATE TABLE psychotherapy_bank_statement_email_imports (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id),
  gmail_message_id   VARCHAR(100) NOT NULL,
  status             VARCHAR(20) NOT NULL DEFAULT 'processing'
                      CHECK (status IN ('processing','processed','rejected_sender',
                                         'rejected_auth','no_attachment','error')),
  import_id          UUID,  -- preenchido quando o import correspondente é resolvido
  error_detail       TEXT,  -- nunca inclui corpo/assunto do e-mail, só a causa técnica
  sender_normalized  VARCHAR(255),  -- só o endereço From, pra tela de rejeitados
  attempt_count      INT NOT NULL DEFAULT 1,
  claim_token        UUID NOT NULL DEFAULT gen_random_uuid(),  -- ownership do worker atual
  claimed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- timestamp de lease, não de criação
  processed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- RESTRICT (não SET NULL) — mesmo padrão já usado em
  -- psychotherapy_bank_statement_transactions, evita o problema de FK
  -- composta com coluna NOT NULL no meio de um SET NULL.
  FOREIGN KEY (import_id, tenant_id)
    REFERENCES psychotherapy_bank_statement_imports (id, tenant_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, gmail_message_id)
);
