-- 070_expand_records_and_payments.sql

ALTER TABLE group_payments ADD COLUMN group_member_id UUID;
ALTER TABLE group_session_records ADD COLUMN group_member_id UUID;

-- Backfill absoluto usando o histórico garantido pela constraint legada
UPDATE group_payments gp
SET group_member_id = tgm.id
FROM therapy_group_members tgm
WHERE gp.tenant_id = tgm.tenant_id
  AND gp.group_id = tgm.group_id
  AND gp.patient_id = tgm.patient_id;

UPDATE group_session_records gsr
SET group_member_id = tgm.id
FROM therapy_group_members tgm
WHERE gsr.tenant_id = tgm.tenant_id
  AND gsr.group_id = tgm.group_id
  AND gsr.patient_id = tgm.patient_id;

-- Aplica as constraints de integridade e not null após backfill
ALTER TABLE group_payments ALTER COLUMN group_member_id SET NOT NULL;
ALTER TABLE group_session_records ALTER COLUMN group_member_id SET NOT NULL;

ALTER TABLE group_payments 
    ADD CONSTRAINT fk_group_payments_member 
    FOREIGN KEY (group_member_id, tenant_id) REFERENCES therapy_group_members(id, tenant_id);

ALTER TABLE group_session_records 
    ADD CONSTRAINT fk_group_session_records_member 
    FOREIGN KEY (group_member_id, tenant_id) REFERENCES therapy_group_members(id, tenant_id);

-- Adiciona a taxonomia do faturamento e seta o backfill
ALTER TABLE group_payments 
    ADD COLUMN charge_type VARCHAR(50) NOT NULL DEFAULT 'monthly' 
    CHECK (charge_type IN ('monthly', 'session', 'course_upfront'));

UPDATE group_payments 
SET charge_type = 'session' 
WHERE group_session_record_id IS NOT NULL;
