-- Migration: 106_meet_link_reminders.sql

ALTER TABLE psychotherapy_reminders_log DROP CONSTRAINT IF EXISTS psychotherapy_reminders_log_channel_used_check;

ALTER TABLE psychotherapy_reminders_log ADD CONSTRAINT psychotherapy_reminders_log_channel_used_check 
  CHECK (channel_used IN ('whatsapp', 'email'));
