/*
  # Organisations (Multi-tenant SaaS foundation) — Part A
  Creates the organisations table without cross-table RLS (added in Part B).
*/

CREATE TABLE IF NOT EXISTS organisations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  slug             text UNIQUE NOT NULL,
  plan             text NOT NULL DEFAULT 'trial',
  plan_expires_at  timestamptz,
  max_users        integer NOT NULL DEFAULT 50,
  contact_email    text NOT NULL DEFAULT '',
  contact_phone    text NOT NULL DEFAULT '',
  logo_url         text NOT NULL DEFAULT '',
  settings         jsonb NOT NULL DEFAULT '{}',
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;

-- Temporary open read policy; replaced in Part B after organisation_id
-- is added to profiles.
CREATE POLICY "Authenticated users can read organisations"
  ON organisations FOR SELECT
  TO authenticated
  USING (true);

-- Seed default organisation for existing demo data
INSERT INTO organisations (id, name, slug, plan, contact_email, active)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Demo Fastigheter AB',
  'demo-fastigheter',
  'professional',
  'admin@demo.se',
  true
)
ON CONFLICT (id) DO NOTHING;
