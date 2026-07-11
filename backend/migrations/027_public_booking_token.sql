-- Token público de agendamento por terapeuta (sem necessidade de paciente cadastrado)
CREATE TABLE IF NOT EXISTS psychotherapy_public_booking_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token      UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL UNIQUE,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
