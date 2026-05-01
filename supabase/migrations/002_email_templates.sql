-- email_templates
CREATE TABLE email_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  subject    text NOT NULL,
  greeting   text NOT NULL,
  body       text NOT NULL,
  closing    text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- Row Level Security
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
