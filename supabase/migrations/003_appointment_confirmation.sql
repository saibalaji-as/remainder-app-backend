-- appointment confirmation lifecycle columns
-- Requirements: 6.1, 6.2, 6.3, 6.4
--
-- NOTE: Run this migration manually in the Supabase SQL Editor.
-- Both additions are idempotent (ADD COLUMN IF NOT EXISTS).

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS confirmation_token text,
  ADD COLUMN IF NOT EXISTS nudge_sent_at timestamptz;
