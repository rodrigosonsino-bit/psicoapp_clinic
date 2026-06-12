-- Migration: 013_booking.sql
-- Descrição: Auto-agendamento pelo paciente
--   1. availability_slots  — horários recorrentes semanais que o terapeuta disponibiliza
--   2. booking_links        — link único por paciente para auto-agendamento

CREATE TABLE IF NOT EXISTS psychotherapy_availability_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    day_of_week SMALLINT NOT NULL,       -- 0=Dom 1=Seg 2=Ter 3=Qua 4=Qui 5=Sex 6=Sáb
    start_time TIME NOT NULL,            -- Hora de início no fuso do servidor
    duration_minutes INTEGER NOT NULL DEFAULT 50,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, day_of_week, start_time)
);

CREATE INDEX IF NOT EXISTS idx_avail_slots_tenant ON psychotherapy_availability_slots(tenant_id);

CREATE TABLE IF NOT EXISTS psychotherapy_booking_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES psychotherapy_patients(id) ON DELETE CASCADE,
    expires_at TIMESTAMP WITH TIME ZONE,   -- NULL = sem expiração
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, patient_id)         -- um link ativo por paciente
);

CREATE INDEX IF NOT EXISTS idx_booking_links_token ON psychotherapy_booking_links(token);
CREATE INDEX IF NOT EXISTS idx_booking_links_tenant ON psychotherapy_booking_links(tenant_id);
