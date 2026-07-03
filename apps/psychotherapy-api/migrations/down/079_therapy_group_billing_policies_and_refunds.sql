-- down/079_therapy_group_billing_policies_and_refunds.sql

DROP TRIGGER IF EXISTS trg_prevent_void_upfront_ledger ON financial_payments;
DROP FUNCTION IF EXISTS trg_prevent_void_upfront_ledger_fn();

DROP TRIGGER IF EXISTS trg_policy_immutability ON therapy_group_member_billing_policies;
DROP FUNCTION IF EXISTS trg_policy_immutability_fn();

DROP TRIGGER IF EXISTS trg_verify_upfront_payment ON therapy_group_member_billing_policies;
DROP FUNCTION IF EXISTS trg_verify_upfront_payment_fn();

DROP TABLE IF EXISTS upfront_refunds;
DROP TABLE IF EXISTS therapy_group_member_billing_policies;
