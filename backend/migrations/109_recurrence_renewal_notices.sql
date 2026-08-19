-- Migration: 109_recurrence_renewal_notices.sql
-- Descrição: Controle de avisos de renovação de série recorrente próxima do
-- fim (feature: cap de 3 meses em série nova + aviso na última semana).
-- Uma linha por ciclo de aviso de uma série — evita reavisar todo dia dentro
-- da janela de 7 dias e registra se o terapeuta renovou/dispensou.

CREATE TABLE psychotherapy_recurrence_renewal_notices (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    appointment_id      UUID NOT NULL REFERENCES psychotherapy_appointments(id) ON DELETE CASCADE,
    patient_id          UUID NOT NULL REFERENCES psychotherapy_patients(id) ON DELETE CASCADE,
    recurrence_end_date DATE NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'renewed', 'dismissed', 'expired')),
    notified_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Um aviso "em aberto" por série (appointment_id = root) — o scheduler
    -- usa isso pra não duplicar linha dentro da mesma janela de 7 dias.
    CONSTRAINT uq_recurrence_renewal_pending_per_appointment
        UNIQUE (appointment_id, recurrence_end_date)
);

CREATE INDEX idx_recurrence_renewal_notices_tenant_status
    ON psychotherapy_recurrence_renewal_notices(tenant_id, status);

CREATE INDEX idx_recurrence_renewal_notices_appointment
    ON psychotherapy_recurrence_renewal_notices(appointment_id);
