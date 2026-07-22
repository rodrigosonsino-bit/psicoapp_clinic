-- Migration: 100_no_overlapping_calendar_events.sql (Down)
-- Descrição: Remove a restrição de exclusão de sobreposição de eventos

ALTER TABLE calendar_events DROP CONSTRAINT IF EXISTS exclude_overlapping_calendar_events;
