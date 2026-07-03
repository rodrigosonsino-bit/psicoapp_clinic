-- Migration: 054_validate_integrity_constraints.sql
-- Descrição: Validação das FKs compostas e constraints CHECK adicionadas na migração anterior.

-- 1. Validação das FKs do grupo Appointments e Sessions
ALTER TABLE psychotherapy_sessions VALIDATE CONSTRAINT fk_sessions_patient_tenant;
ALTER TABLE psychotherapy_appointments VALIDATE CONSTRAINT fk_appointments_patient_tenant;
ALTER TABLE psychotherapy_appointments VALIDATE CONSTRAINT fk_appointments_group_tenant;
ALTER TABLE psychotherapy_appointments VALIDATE CONSTRAINT fk_appointments_parent_tenant;
ALTER TABLE psychotherapy_appointments VALIDATE CONSTRAINT fk_appointments_calendar_event_tenant;

-- 2. Validação das FKs do grupo Clinical Notes, Receipts e Pix Charges
ALTER TABLE psychotherapy_receipts VALIDATE CONSTRAINT fk_receipts_patient_tenant;
ALTER TABLE psychotherapy_clinical_notes VALIDATE CONSTRAINT fk_clinical_notes_patient_tenant;
ALTER TABLE psychotherapy_clinical_notes VALIDATE CONSTRAINT fk_clinical_notes_session_tenant;
ALTER TABLE psychotherapy_pix_charges VALIDATE CONSTRAINT fk_pix_charges_patient_tenant;
ALTER TABLE psychotherapy_pix_charges VALIDATE CONSTRAINT fk_pix_charges_monthly_record_tenant;

-- 3. Validação das FKs do grupo Anamnese, Planos de Tratamento, Monthly Records e Booking
ALTER TABLE psychotherapy_monthly_records VALIDATE CONSTRAINT fk_monthly_records_patient_tenant;
ALTER TABLE psychotherapy_anamnesis VALIDATE CONSTRAINT fk_anamnesis_patient_tenant;
ALTER TABLE psychotherapy_treatment_plans VALIDATE CONSTRAINT fk_treatment_plans_patient_tenant;
ALTER TABLE psychotherapy_booking_links VALIDATE CONSTRAINT fk_booking_links_patient_tenant;

-- 4. Validação das FKs de Grupos, Membros e Reminders
ALTER TABLE group_payments VALIDATE CONSTRAINT fk_group_payments_patient_tenant;
ALTER TABLE group_payments VALIDATE CONSTRAINT fk_group_payments_group_tenant;
ALTER TABLE group_session_records VALIDATE CONSTRAINT fk_group_sessions_patient_tenant;
ALTER TABLE group_session_records VALIDATE CONSTRAINT fk_group_sessions_group_tenant;
ALTER TABLE group_session_records VALIDATE CONSTRAINT fk_group_sessions_appointment_tenant;
ALTER TABLE psychotherapy_reminders_log VALIDATE CONSTRAINT fk_reminders_appointment_tenant;
ALTER TABLE therapy_group_members VALIDATE CONSTRAINT fk_group_members_group_tenant;
ALTER TABLE therapy_group_members VALIDATE CONSTRAINT fk_group_members_patient_tenant;

-- 5. Validação dos CHECKs de nulidade das colunas migradas
ALTER TABLE psychotherapy_appointments VALIDATE CONSTRAINT chk_calendar_event_id_not_null;
ALTER TABLE therapy_group_members VALIDATE CONSTRAINT chk_group_members_tenant_id_not_null;
ALTER TABLE auth_refresh_tokens VALIDATE CONSTRAINT chk_refresh_tokens_family_id_not_null;
