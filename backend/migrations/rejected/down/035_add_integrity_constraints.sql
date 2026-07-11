-- Down migration for 035_add_integrity_constraints.sql

-- 1. Drop composite constraints on Group Session Records and restore simple FKs
ALTER TABLE group_session_records DROP CONSTRAINT IF EXISTS fk_group_session_records_patient_tenant;
ALTER TABLE group_session_records DROP CONSTRAINT IF EXISTS fk_group_session_records_group_tenant;
ALTER TABLE group_session_records DROP CONSTRAINT IF EXISTS fk_group_session_records_appointment_tenant;

ALTER TABLE group_session_records ADD CONSTRAINT group_session_records_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES psychotherapy_patients(id) ON DELETE RESTRICT;
ALTER TABLE group_session_records ADD CONSTRAINT group_session_records_group_id_fkey FOREIGN KEY (group_id) REFERENCES therapy_groups(id) ON DELETE RESTRICT;
ALTER TABLE group_session_records ADD CONSTRAINT group_session_records_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES psychotherapy_appointments(id) ON DELETE SET NULL;

-- 2. Group Payments
ALTER TABLE group_payments DROP CONSTRAINT IF EXISTS fk_group_payments_patient_tenant;
ALTER TABLE group_payments DROP CONSTRAINT IF EXISTS fk_group_payments_group_tenant;

ALTER TABLE group_payments ADD CONSTRAINT group_payments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES psychotherapy_patients(id) ON DELETE RESTRICT;
ALTER TABLE group_payments ADD CONSTRAINT group_payments_group_id_fkey FOREIGN KEY (group_id) REFERENCES therapy_groups(id) ON DELETE RESTRICT;

-- 3. Treatment Plans
ALTER TABLE psychotherapy_treatment_plans DROP CONSTRAINT IF EXISTS fk_treatment_plans_patient_tenant;
ALTER TABLE psychotherapy_treatment_plans ADD CONSTRAINT psychotherapy_treatment_plans_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES psychotherapy_patients(id) ON DELETE CASCADE;

-- 4. Anamnesis
ALTER TABLE psychotherapy_anamnesis DROP CONSTRAINT IF EXISTS fk_anamnesis_patient_tenant;
ALTER TABLE psychotherapy_anamnesis ADD CONSTRAINT psychotherapy_anamnesis_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES psychotherapy_patients(id) ON DELETE CASCADE;

-- 5. Monthly Records
ALTER TABLE psychotherapy_monthly_records DROP CONSTRAINT IF EXISTS fk_monthly_records_patient_tenant;
ALTER TABLE psychotherapy_monthly_records ADD CONSTRAINT psychotherapy_monthly_records_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES psychotherapy_patients(id) ON DELETE SET NULL;

-- 6. Pix Charges
ALTER TABLE psychotherapy_pix_charges DROP CONSTRAINT IF EXISTS fk_pix_charges_patient_tenant;
ALTER TABLE psychotherapy_pix_charges ADD CONSTRAINT psychotherapy_pix_charges_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES psychotherapy_patients(id) ON DELETE CASCADE;

-- 7. Clinical Notes
ALTER TABLE psychotherapy_clinical_notes DROP CONSTRAINT IF EXISTS fk_clinical_notes_patient_tenant;
ALTER TABLE psychotherapy_clinical_notes DROP CONSTRAINT IF EXISTS fk_clinical_notes_session_tenant;

ALTER TABLE psychotherapy_clinical_notes ADD CONSTRAINT psychotherapy_clinical_notes_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES psychotherapy_patients(id) ON DELETE CASCADE;
ALTER TABLE psychotherapy_clinical_notes ADD CONSTRAINT psychotherapy_clinical_notes_session_id_fkey FOREIGN KEY (session_id) REFERENCES psychotherapy_sessions(id) ON DELETE CASCADE;

-- 8. Reminders Log
ALTER TABLE psychotherapy_reminders_log DROP CONSTRAINT IF EXISTS fk_reminders_log_appointment_tenant;
ALTER TABLE psychotherapy_reminders_log ADD CONSTRAINT psychotherapy_reminders_log_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES psychotherapy_appointments(id) ON DELETE CASCADE;

-- 9. Booking Links
ALTER TABLE psychotherapy_booking_links DROP CONSTRAINT IF EXISTS fk_booking_links_patient_tenant;
ALTER TABLE psychotherapy_booking_links DROP CONSTRAINT IF EXISTS fk_booking_links_tenant;

ALTER TABLE psychotherapy_booking_links ADD CONSTRAINT psychotherapy_booking_links_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES psychotherapy_patients(id) ON DELETE CASCADE;
ALTER TABLE psychotherapy_booking_links ADD CONSTRAINT psychotherapy_booking_links_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- 10. Appointments
ALTER TABLE psychotherapy_appointments DROP CONSTRAINT IF EXISTS fk_appointments_patient_tenant;
ALTER TABLE psychotherapy_appointments DROP CONSTRAINT IF EXISTS fk_appointments_group_tenant;
ALTER TABLE psychotherapy_appointments DROP CONSTRAINT IF EXISTS fk_appointments_calendar_event;
ALTER TABLE psychotherapy_appointments DROP CONSTRAINT IF EXISTS fk_appointments_parent_tenant;

ALTER TABLE psychotherapy_appointments ADD CONSTRAINT psychotherapy_appointments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES psychotherapy_patients(id) ON DELETE CASCADE;
ALTER TABLE psychotherapy_appointments ADD CONSTRAINT psychotherapy_appointments_group_id_fkey FOREIGN KEY (group_id) REFERENCES therapy_groups(id) ON DELETE SET NULL;
ALTER TABLE psychotherapy_appointments ADD CONSTRAINT psychotherapy_appointments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES psychotherapy_appointments(id) ON DELETE SET NULL;

-- 11. Receipts
ALTER TABLE psychotherapy_receipts DROP CONSTRAINT IF EXISTS fk_receipts_patient_tenant;
ALTER TABLE psychotherapy_receipts ADD CONSTRAINT psychotherapy_receipts_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES psychotherapy_patients(id) ON DELETE CASCADE;

-- 12. Sessions
ALTER TABLE psychotherapy_sessions DROP CONSTRAINT IF EXISTS fk_sessions_patient_tenant;
ALTER TABLE psychotherapy_sessions ADD CONSTRAINT psychotherapy_sessions_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES psychotherapy_patients(id) ON DELETE CASCADE;

-- 13. Drop calendar_event_id column from appointments and events table
ALTER TABLE psychotherapy_appointments DROP COLUMN IF EXISTS calendar_event_id;
DROP TABLE IF EXISTS calendar_events CASCADE;

-- 14. therapy_group_members rollback
ALTER TABLE therapy_group_members DROP CONSTRAINT IF EXISTS fk_group_members_group;
ALTER TABLE therapy_group_members DROP CONSTRAINT IF EXISTS fk_group_members_patient;
ALTER TABLE therapy_group_members DROP CONSTRAINT IF EXISTS uq_group_members_group_patient;

ALTER TABLE therapy_group_members ADD CONSTRAINT therapy_group_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES therapy_groups(id) ON DELETE CASCADE;
ALTER TABLE therapy_group_members ADD CONSTRAINT therapy_group_members_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES psychotherapy_patients(id) ON DELETE CASCADE;
ALTER TABLE therapy_group_members ADD CONSTRAINT therapy_group_members_group_id_patient_id_key UNIQUE (group_id, patient_id);
ALTER TABLE therapy_group_members DROP COLUMN IF EXISTS tenant_id;

-- 15. Tables two_factor_challenges & failed_totp_attempts
DROP TABLE IF EXISTS two_factor_challenges CASCADE;
DROP TABLE IF EXISTS failed_totp_attempts CASCADE;

-- 16. Remove deleted_at column from patients and clean_document_immutable function
ALTER TABLE psychotherapy_patients DROP COLUMN IF EXISTS deleted_at;
DROP FUNCTION IF EXISTS clean_document_immutable(text) CASCADE;

-- 17. Drop candidate keys uq constraints
ALTER TABLE psychotherapy_patients DROP CONSTRAINT IF EXISTS uq_psychotherapy_patient_tenant;
ALTER TABLE psychotherapy_sessions DROP CONSTRAINT IF EXISTS uq_session_tenant;
ALTER TABLE psychotherapy_monthly_records DROP CONSTRAINT IF EXISTS uq_monthly_record_tenant;
ALTER TABLE psychotherapy_appointments DROP CONSTRAINT IF EXISTS uq_appointment_tenant;
ALTER TABLE therapy_groups DROP CONSTRAINT IF EXISTS uq_group_tenant;
