-- Down Migration: 056_ledger_immutability.sql

DROP TRIGGER IF EXISTS trg_protect_financial_payments ON financial_payments;
DROP FUNCTION IF EXISTS protect_financial_payments_immutability();

GRANT DELETE ON TABLE financial_payments TO PUBLIC;
