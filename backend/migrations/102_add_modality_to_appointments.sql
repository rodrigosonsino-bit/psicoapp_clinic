-- Migration: 102_add_modality_to_appointments.sql (Up)
-- Descrição: Adiciona coluna modality em psychotherapy_appointments para diferenciar atendimentos online de presenciais

ALTER TABLE psychotherapy_appointments 
ADD COLUMN IF NOT EXISTS modality VARCHAR(20) NOT NULL DEFAULT 'online'
CHECK (modality IN ('online', 'presencial'));
