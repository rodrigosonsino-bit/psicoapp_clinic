-- down/069_therapy_group_members_remodel.sql

ALTER TABLE therapy_group_members 
    ADD CONSTRAINT therapy_group_members_group_id_patient_id_key UNIQUE (group_id, patient_id);

DROP INDEX IF EXISTS uq_active_group_member;

ALTER TABLE therapy_group_members 
    DROP CONSTRAINT IF EXISTS uq_therapy_group_members_tenant;
