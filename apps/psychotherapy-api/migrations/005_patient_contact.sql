-- Migration: 005_patient_contact.sql
-- Descrição: Adiciona colunas de contato (telefone e email) na tabela de pacientes
-- Criado em: 2026-06-02

ALTER TABLE psychotherapy_patients
ADD COLUMN IF NOT EXISTS phone VARCHAR(20),
ADD COLUMN IF NOT EXISTS email VARCHAR(255);
