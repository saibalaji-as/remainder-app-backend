-- Provider tracking for outbound reminders.
-- Twilio returns "queued/sent/delivered/undelivered/failed" asynchronously via
-- status callbacks, so the app must not treat API acceptance as final delivery.

ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS provider_error_code text;

CREATE INDEX IF NOT EXISTS idx_reminders_provider_message_id
  ON reminders (provider_message_id);
