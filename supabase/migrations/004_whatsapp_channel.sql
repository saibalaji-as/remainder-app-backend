-- Migration: 004_whatsapp_channel.sql
-- Adds CHECK constraints to support WhatsApp as a reminder channel.
-- Both constraints are additive — no existing rows are modified.

-- Add CHECK constraint on appointments.reminder_channel
-- Allows all seven valid channel values (including legacy 'both')
ALTER TABLE appointments
  ADD CONSTRAINT appointments_reminder_channel_check
  CHECK (reminder_channel IN (
    'sms', 'email', 'both',
    'whatsapp', 'whatsapp_sms', 'whatsapp_email', 'all'
  ));

-- Add CHECK constraint on reminders.channel
-- Allows the three individual delivery channel values
ALTER TABLE reminders
  ADD CONSTRAINT reminders_channel_check
  CHECK (channel IN ('sms', 'email', 'whatsapp'));
