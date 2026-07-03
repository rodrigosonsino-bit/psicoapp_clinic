-- Migration: 053_integrity_constraints_not_valid.sql
-- Descrição: Criação das chaves únicas candidatas em tabelas remanescentes e FKs compostas como NOT VALID.

-- 1. Criação das chaves únicas candidatas
ALTER TABLE therapy_groups ADD CONSTRAINT uq_therapy_groups_tenant UNIQUE (id, tenant_id);
ALTER TABLE psychotherapy_appointments ADD CONSTRAINT uq_psychotherapy_appointments_tenant UNIQUE (id, tenant_id);
ALTER TABLE psychotherapy_sessions ADD CONSTRAINT uq_psychotherapy_sessions_tenant UNIQUE (id, tenant_id);

-- 2. Restrições CHECK temporárias de não nulidade
ALTER TABLE psychotherapy_appointments ADD CONSTRAINT chk_calendar_event_id_not_null CHECK (calendar_event_id IS NOT NULL) NOT VALID;
ALTER TABLE therapy_group_members ADD CONSTRAINT chk_group_members_tenant_id_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE auth_refresh_tokens ADD CONSTRAINT chk_refresh_tokens_family_id_not_null CHECK (family_id IS NOT NULL) NOT VALID;

-- 3. Composite Foreign Keys as NOT VALID
ALTER TABLE psychotherapy_sessions ADD CONSTRAINT fk_sessions_patient_tenant 
  FOREIGN KEY (patient_id, tenant_id) REFERENCES psychotherapy_patients(id, tenant_id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE psychotherapy_receipts ADD CONSTRAINT fk_receipts_patient_tenant 
  FOREIGN KEY (patient_id, tenant_id) REFERENCES psychotherapy_patients(id, tenant_id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE psychotherapy_appointments ADD CONSTRAINT fk_appointments_patient_tenant 
  FOREIGN KEY (patient_id, tenant_id) REFERENCES psychotherapy_patients(id, tenant_id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE psychotherapy_appointments ADD CONSTRAINT fk_appointments_group_tenant 
  FOREIGN KEY (group_id, tenant_id) REFERENCES therapy_groups(id, tenant_id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE psychotherapy_appointments ADD CONSTRAINT fk_appointments_parent_tenant 
  FOREIGN KEY (parent_id, tenant_id) REFERENCES psychotherapy_appointments(id, tenant_id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE psychotherapy_appointments ADD CONSTRAINT fk_appointments_calendar_event_tenant 
  FOREIGN KEY (calendar_event_id, tenant_id) REFERENCES calendar_events(id, tenant_id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE psychotherapy_clinical_notes ADD CONSTRAINT fk_clinical_notes_patient_tenant 
  FOREIGN KEY (patient_id, tenant_id) REFERENCES psychotherapy_patients(id, tenant_id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE psychotherapy_clinical_notes ADD CONSTRAINT fk_clinical_notes_session_tenant 
  FOREIGN KEY (session_id, tenant_id) REFERENCES psychotherapy_sessions(id, tenant_id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE psychotherapy_pix_charges ADD CONSTRAINT fk_pix_charges_patient_tenant 
  FOREIGN KEY (patient_id, tenant_id) REFERENCES psychotherapy_patients(id, tenant_id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE psychotherapy_pix_charges ADD CONSTRAINT fk_pix_charges_monthly_record_tenant 
  FOREIGN KEY (monthly_record_id, tenant_id) REFERENCES psychotherapy_monthly_records(id, tenant_id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE psychotherapy_monthly_records ADD CONSTRAINT fk_monthly_records_patient_tenant 
  FOREIGN KEY (patient_id, tenant_id) REFERENCES psychotherapy_patients(id, tenant_id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE psychotherapy_anamnesis ADD CONSTRAINT fk_anamnesis_patient_tenant 
  FOREIGN KEY (patient_id, tenant_id) REFERENCES psychotherapy_patients(id, tenant_id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE psychotherapy_treatment_plans ADD CONSTRAINT fk_treatment_plans_patient_tenant 
  FOREIGN KEY (patient_id, tenant_id) REFERENCES psychotherapy_patients(id, tenant_id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE psychotherapy_booking_links ADD CONSTRAINT fk_booking_links_patient_tenant 
  FOREIGN KEY (patient_id, tenant_id) REFERENCES psychotherapy_patients(id, tenant_id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE group_payments ADD CONSTRAINT fk_group_payments_patient_tenant 
  FOREIGN KEY (patient_id, tenant_id) REFERENCES psychotherapy_patients(id, tenant_id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE group_payments ADD CONSTRAINT fk_group_payments_group_tenant 
  FOREIGN KEY (group_id, tenant_id) REFERENCES therapy_groups(id, tenant_id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE group_session_records ADD CONSTRAINT fk_group_sessions_patient_tenant 
  FOREIGN KEY (patient_id, tenant_id) REFERENCES psychotherapy_patients(id, tenant_id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE group_session_records ADD CONSTRAINT fk_group_sessions_group_tenant 
  FOREIGN KEY (group_id, tenant_id) REFERENCES therapy_groups(id, tenant_id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE group_session_records ADD CONSTRAINT fk_group_sessions_appointment_tenant 
  FOREIGN KEY (appointment_id, tenant_id) REFERENCES psychotherapy_appointments(id, tenant_id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE psychotherapy_reminders_log ADD CONSTRAINT fk_reminders_appointment_tenant 
  FOREIGN KEY (appointment_id, tenant_id) REFERENCES psychotherapy_appointments(id, tenant_id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE therapy_group_members ADD CONSTRAINT fk_group_members_group_tenant 
  FOREIGN KEY (group_id, tenant_id) REFERENCES therapy_groups(id, tenant_id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE therapy_group_members ADD CONSTRAINT fk_group_members_patient_tenant 
  FOREIGN KEY (patient_id, tenant_id) REFERENCES psychotherapy_patients(id, tenant_id) ON DELETE RESTRICT NOT VALID;
