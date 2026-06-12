-- Migration: 020_patient_fullname.sql
-- Descrição: Adiciona coluna full_name à tabela de pacientes
-- Criado em: 2026-06-08

ALTER TABLE psychotherapy_patients
ADD COLUMN IF NOT EXISTS full_name VARCHAR(255);
