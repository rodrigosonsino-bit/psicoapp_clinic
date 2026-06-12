-- Migration: 010_pix_charges.sql
-- Descrição: Tabela de cobranças Pix com rastreamento de status

DO $$ BEGIN
    CREATE TYPE pix_charge_status AS ENUM ('pending', 'paid', 'expired', 'canceled');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS psychotherapy_pix_charges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES psychotherapy_patients(id) ON DELETE CASCADE,
    monthly_record_id UUID REFERENCES psychotherapy_monthly_records(id) ON DELETE SET NULL,
    amount_cents INTEGER NOT NULL,
    description TEXT NOT NULL,
    status pix_charge_status NOT NULL DEFAULT 'pending',
    provider_charge_id TEXT,
    provider_txid TEXT UNIQUE,
    qr_code TEXT,
    qr_code_image_url TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    paid_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pix_charges_tenant ON psychotherapy_pix_charges(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pix_charges_patient ON psychotherapy_pix_charges(patient_id);
CREATE INDEX IF NOT EXISTS idx_pix_charges_txid ON psychotherapy_pix_charges(provider_txid);
CREATE INDEX IF NOT EXISTS idx_pix_charges_status ON psychotherapy_pix_charges(status);
