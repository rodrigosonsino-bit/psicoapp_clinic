-- migrate:transaction=false
-- Migration: 058_group_financial_indexes_concurrently.sql
-- noTransaction
-- Descrição: Criação de índices parciais e concorrentes para a nova modelagem de grupos e financeiro.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_individual_therapy_enabled
    ON psychotherapy_patients(tenant_id, name)
    WHERE deleted_at IS NULL AND individual_therapy_enabled = TRUE;
