-- Migration: 097_add_missing_receipt_snapshot_columns.sql
-- Descrição: Cria em psychotherapy_receipts as colunas de snapshot imutável
-- (patient_name_snapshot, patient_document_snapshot, tenant_name_snapshot,
-- tenant_document_snapshot, tenant_professional_id_snapshot,
-- tenant_address_snapshot) que o código de aplicação (saveReceipt em
-- PostgresBillingRepository.ts, mapReceipt em shared.ts, ReceiptRow em
-- dbRowTypes.ts, PsychotherapyReceipt model, e o frontend em
-- src/pages/Receipts.tsx) sempre esperou existirem, mas que nunca foram
-- criadas em nenhuma migration anterior — achado ao rodar testes de
-- integração pela primeira vez contra um schema real (2026-07-18).
--
-- A migration 043_expand_receipts.sql adicionou colunas com OUTRO desenho
-- (provider_name/provider_document/provider_professional_id/provider_address,
-- beneficiary_name/beneficiary_document, responsible_name/responsible_document)
-- que parecem ter sido a intenção de substituir o modelo patient/tenant
-- snapshot, mas nenhum código (backend ou frontend) em todo o repositório
-- referencia essas colunas provider_*/beneficiary_*/responsible_* — ficaram
-- órfãs. Em vez de reescrever o código pra adotar um desenho nunca usado
-- (risco maior, contrato já espalhado pelo frontend), esta migration
-- simplesmente cria as colunas que o código sempre assumiu, restaurando a
-- funcionalidade de emissão de recibo novo (INSERT em saveReceipt() falhava
-- com "column does not exist" pra QUALQUER recibo novo criado enquanto essas
-- colunas não existiam).
--
-- Runner gerencia a transação — NÃO incluir BEGIN/COMMIT aqui.

ALTER TABLE psychotherapy_receipts ADD COLUMN IF NOT EXISTS patient_name_snapshot VARCHAR(255);
ALTER TABLE psychotherapy_receipts ADD COLUMN IF NOT EXISTS patient_document_snapshot VARCHAR(20);
ALTER TABLE psychotherapy_receipts ADD COLUMN IF NOT EXISTS tenant_name_snapshot VARCHAR(255);
ALTER TABLE psychotherapy_receipts ADD COLUMN IF NOT EXISTS tenant_document_snapshot VARCHAR(20);
ALTER TABLE psychotherapy_receipts ADD COLUMN IF NOT EXISTS tenant_professional_id_snapshot VARCHAR(50);
ALTER TABLE psychotherapy_receipts ADD COLUMN IF NOT EXISTS tenant_address_snapshot TEXT;
