-- Migration: 096_backfill_missing_group_billing_policies.sql
-- Descrição: backfill de dados. A migration 079 criou a tabela
-- therapy_group_member_billing_policies mas não fez backfill dos membros de
-- grupo já existentes (adicionados antes de 2026-07-03) — desde então,
-- RegisterGroupSessionUseCase rejeita QUALQUER registro de sessão pra um
-- membro sem política ativa na data ("Matrícula ... não possui política de
-- faturamento na data da sessão"), bloqueando silenciosamente o registro de
-- sessões de grupos criados antes da migration 079.
--
-- Cria uma política 'group_default' pra cada matrícula ativa (left_at IS
-- NULL) que ainda não tem nenhuma política, com valid_from = joined_at e
-- valid_until em aberto — mesmo padrão exato usado por
-- AttachExistingGroupMemberUseCase.ts ao adicionar um membro novo
-- (billing_type='group_default', approved_by=patient_id, status='active').
-- Idempotente: só insere onde NOT EXISTS, seguro rodar mais de uma vez.

INSERT INTO therapy_group_member_billing_policies (
    id, tenant_id, group_id, patient_id, member_id,
    billing_type, valid_from, approved_by, status
)
SELECT
    gen_random_uuid(), tgm.tenant_id, tgm.group_id, tgm.patient_id, tgm.id,
    'group_default', tgm.joined_at, tgm.patient_id, 'active'
FROM therapy_group_members tgm
WHERE tgm.left_at IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM therapy_group_member_billing_policies bp
      WHERE bp.member_id = tgm.id
  );
