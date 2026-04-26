-- tenants
CREATE TABLE tenants (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL,
  email                text UNIQUE NOT NULL,
  plan                 text,
  stripe_customer_id   text,
  created_at           timestamptz DEFAULT now()
);

-- users
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text,
  email         text UNIQUE NOT NULL,
  role          text,
  password_hash text NOT NULL,
  created_at    timestamptz DEFAULT now()
);

-- contacts
CREATE TABLE contacts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       text NOT NULL,
  phone      text,
  email      text,
  created_at timestamptz DEFAULT now()
);

-- appointments
CREATE TABLE appointments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id       uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  title            text,
  scheduled_at     timestamptz NOT NULL,
  reminder_channel text,
  status           text NOT NULL DEFAULT 'scheduled',
  notes            text,
  created_at       timestamptz DEFAULT now()
);

-- reminders
CREATE TABLE reminders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  channel        text,
  status         text NOT NULL DEFAULT 'pending',
  scheduled_at   timestamptz,
  sent_at        timestamptz,
  message        text
);

-- subscriptions
CREATE TABLE subscriptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_customer_id     text,
  stripe_subscription_id text,
  plan                   text,
  sms_credits            int DEFAULT 0,
  status                 text,
  renews_at              timestamptz
);

-- Row Level Security
ALTER TABLE contacts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders    ENABLE ROW LEVEL SECURITY;
