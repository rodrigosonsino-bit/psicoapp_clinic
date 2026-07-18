-- Down 096_backfill_missing_group_billing_policies.sql
-- Não há reversão física possível: therapy_group_member_billing_policies
-- tem um trigger (trg_policy_immutability, migration 079) que bloqueia
-- DELETE em qualquer linha. Reverter esta migration significaria voltar
-- ao estado quebrado (registro de sessão de grupo rejeitado). Se
-- necessário desfazer, cancelar manualmente as políticas específicas via
-- UPDATE ... SET status = 'canceled' (permitido pelo trigger), não aqui.
SELECT 1;
