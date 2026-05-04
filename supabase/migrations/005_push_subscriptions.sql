-- Push subscriptions for Web Push notifications
-- Stores one row per browser/device per user.
-- A user can have multiple subscriptions (phone + laptop + tablet).

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  endpoint   text NOT NULL,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz DEFAULT now(),

  -- One endpoint is unique per tenant+user — upsert-safe
  UNIQUE (tenant_id, user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_tenant
  ON push_subscriptions (tenant_id);
