-- Migration: 008_appointments.sql
-- Descrição: Tabela de agendamentos de sessões com suporte a recorrência

DO $$ BEGIN
    CREATE TYPE appointment_status AS ENUM ('scheduled', 'confirmed', 'attended', 'canceled', 'no_show');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE recurrence_type AS ENUM ('none', 'weekly', 'biweekly');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS psychotherapy_appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES psychotherapy_patients(id) ON DELETE CASCADE,
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 50,
    status appointment_status NOT NULL DEFAULT 'scheduled',
    recurrence recurrence_type NOT NULL DEFAULT 'none',
    recurrence_end_date DATE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_appointments_tenant ON psychotherapy_appointments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON psychotherapy_appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled_at ON psychotherapy_appointments(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_date ON psychotherapy_appointments(tenant_id, scheduled_at);
