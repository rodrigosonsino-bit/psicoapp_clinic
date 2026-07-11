-- 077_appointments_idx.sql
-- noTransaction

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_appointments_group_patient_slot 
ON psychotherapy_appointments (tenant_id, group_id, patient_id, calendar_event_id) 
WHERE group_id IS NOT NULL AND status <> 'canceled';
