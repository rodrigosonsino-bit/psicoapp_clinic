-- 069_therapy_group_members_remodel.sql

-- A tabela já possui a coluna 'id' UUID PRIMARY KEY DEFAULT gen_random_uuid().
-- Precisamos apenas garantir a unicidade cross-tenant para habilitar FKs compostas seguras,
-- dropar a constraint legada que limitava o histórico e criar a nova constraint de ciclo ativo.

ALTER TABLE therapy_group_members 
    ADD CONSTRAINT uq_therapy_group_members_tenant UNIQUE (id, tenant_id);

CREATE UNIQUE INDEX uq_active_group_member 
    ON therapy_group_members(tenant_id, group_id, patient_id) 
    WHERE left_at IS NULL;

-- Remove a constraint legada que impedia reentrada (mesmo paciente no mesmo grupo)
ALTER TABLE therapy_group_members 
    DROP CONSTRAINT IF EXISTS therapy_group_members_group_id_patient_id_key;
