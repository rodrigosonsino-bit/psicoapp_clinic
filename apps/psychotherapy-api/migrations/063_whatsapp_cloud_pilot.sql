-- Migration: 063_whatsapp_cloud_pilot.sql
-- Descrição: Suporte ao piloto single-tenant da WhatsApp Cloud API (Meta) para lembretes.
-- Expand-only: nenhuma coluna/tabela existente é alterada de forma destrutiva; o fluxo Baileys
-- atual (psychotherapy_reminders_log, markReminderSent, hasReminderBeenSent) continua idêntico.

-- ── Extensão mínima do log existente ────────────────────────────────────────────
-- `provider` identifica qual canal técnico foi usado (NULL = registros antigos / Baileys).
-- `retry_eligible` permite marcar resultados AMBÍGUOS (timeout/5xx após envio à Meta) como
-- não-retentáveis automaticamente, evitando duplicar mensagens — ver findFailedWhatsappReminders.
ALTER TABLE psychotherapy_reminders_log
    ADD COLUMN IF NOT EXISTS provider VARCHAR(20) CHECK (provider IN ('baileys', 'meta_cloud')),
    ADD COLUMN IF NOT EXISTS retry_eligible BOOLEAN NOT NULL DEFAULT TRUE;

-- ── Tentativas de envio via Cloud API (uma linha por chamada HTTP à Meta) ───────
-- Não armazena telefone nem corpo/erro bruto — apenas o necessário para auditoria e correlação.
-- 'reserved' é o estado inicial: a linha é inserida ANTES de chamar a Meta (reserva atômica —
-- ver PostgresWhatsappCloudRepository.reserveAttempt), e só então atualizada com o resultado
-- real. Isso evita que duas execuções concorrentes enviem a mesma mensagem duas vezes: a
-- UNIQUE(appointment_id, attempt_number) faz a segunda tentativa de reserva falhar com erro de
-- violação de unicidade em vez de silenciosamente prosseguir para a chamada à Meta.
CREATE TABLE IF NOT EXISTS psychotherapy_whatsapp_cloud_attempts (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    appointment_id          UUID NOT NULL REFERENCES psychotherapy_appointments(id) ON DELETE CASCADE,
    attempt_number          INT NOT NULL,
    http_status             INT,
    submission_result       VARCHAR(20) NOT NULL DEFAULT 'reserved'
        CHECK (submission_result IN ('reserved', 'accepted', 'rejected', 'unknown')),
    provider_message_id     VARCHAR(100),
    provider_error_code     VARCHAR(50),
    provider_error_message  VARCHAR(500),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (appointment_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_cloud_attempts_appointment
    ON psychotherapy_whatsapp_cloud_attempts(appointment_id);

-- ── Estado de entrega por mensagem (projeção atualizada pelo webhook) ───────────
-- Uma linha por wamid aceito pela Meta. `delivery_status` avança de forma monotônica
-- (submitted → delivered → read; failed é terminal) — a lógica de não-regressão fica na
-- aplicação (worker do webhook), não é imposta aqui via constraint.
CREATE TABLE IF NOT EXISTS psychotherapy_whatsapp_cloud_status (
    provider_message_id    VARCHAR(100) PRIMARY KEY,
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    appointment_id          UUID REFERENCES psychotherapy_appointments(id) ON DELETE CASCADE,
    delivery_status         VARCHAR(20) NOT NULL DEFAULT 'submitted'
        CHECK (delivery_status IN ('submitted', 'delivered', 'read', 'failed')),
    last_status_at          TIMESTAMPTZ,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Inbox durável de eventos do webhook (dedup + processamento assíncrono) ──────
-- Um registro por ITEM de status/mensagem (não por payload/envelope inteiro), pois um único
-- webhook da Meta pode trazer vários status numa call só.
-- `claimed_until`: lease do worker — sem isso, o FOR UPDATE SKIP LOCKED só protege durante a
-- própria transação de claim; depois do commit, uma execução sobreposta do cron poderia
-- reivindicar a mesma linha de novo antes do processamento anterior terminar.
CREATE TABLE IF NOT EXISTS whatsapp_cloud_webhook_events (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type              VARCHAR(20) NOT NULL CHECK (event_type IN ('status', 'message')),
    provider_message_id     VARCHAR(100),
    status_value            VARCHAR(20),
    provider_timestamp      TIMESTAMPTZ,
    raw_payload             JSONB NOT NULL,
    received_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at            TIMESTAMPTZ,
    processing_attempts     INT NOT NULL DEFAULT 0,
    next_retry_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimed_until           TIMESTAMPTZ,
    dead_letter              BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK (event_type <> 'status' OR (provider_message_id IS NOT NULL AND status_value IS NOT NULL AND provider_timestamp IS NOT NULL))
);

-- Dedup real: statuses[].id da Meta é o WAMID, repetido em sent/delivered/read — dedup precisa
-- incluir o status e o timestamp do provider, não só o id da mensagem. O CHECK acima garante que
-- essas 3 colunas nunca são NULL para event_type='status', então nenhuma linha escapa da unicidade
-- (Postgres trata NULL como distinto em índices únicos).
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_webhook_status_event
    ON whatsapp_cloud_webhook_events (provider_message_id, status_value, provider_timestamp)
    WHERE event_type = 'status';

CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_unprocessed
    ON whatsapp_cloud_webhook_events (next_retry_at)
    WHERE processed_at IS NULL AND dead_letter = FALSE;

-- ── Registro de templates aprovados na Meta ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_cloud_templates (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purpose                 VARCHAR(50) NOT NULL,
    meta_template_name      VARCHAR(150) NOT NULL,
    language_code           VARCHAR(10) NOT NULL,
    parameter_schema        JSONB NOT NULL,
    meta_status              VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (meta_status IN ('PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED')),
    active                   BOOLEAN NOT NULL DEFAULT FALSE,
    last_synced_at           TIMESTAMPTZ,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (meta_template_name, language_code)
);

-- Só um template ativo por finalidade+idioma (evita ambiguidade na hora de enviar).
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_template_active_purpose
    ON whatsapp_cloud_templates (purpose, language_code)
    WHERE active = TRUE;
