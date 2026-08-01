BEGIN;

ALTER TABLE tenants ADD COLUMN automatic_billing_reminders BOOLEAN DEFAULT FALSE;

ALTER TABLE psychotherapy_patients ADD COLUMN automatic_billing_opt_out BOOLEAN DEFAULT FALSE;

CREATE TABLE billing_reminders_log (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES psychotherapy_patients(id) ON DELETE CASCADE,
    month VARCHAR(7) NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (tenant_id, patient_id, month)
);

COMMIT;
