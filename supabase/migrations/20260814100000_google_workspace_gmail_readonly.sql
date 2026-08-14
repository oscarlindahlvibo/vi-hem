-- Google Workspace / Gmail read-only integration.
-- Mailbox addresses are an organisation-scoped allowlist. Credentials never live here.
CREATE TABLE IF NOT EXISTS public.vihem_mail_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.vihem_companies(id) ON DELETE SET NULL,
  email text NOT NULL,
  display_name text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  search_general boolean NOT NULL DEFAULT true,
  search_invoices boolean NOT NULL DEFAULT true,
  last_tested_at timestamptz,
  last_test_status text NOT NULL DEFAULT 'not_tested' CHECK (last_test_status IN ('not_tested','ok','failed')),
  last_test_error_code text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, email)
);

CREATE INDEX IF NOT EXISTS vihem_mail_accounts_org_active_idx
  ON public.vihem_mail_accounts (organisation_id, active);

CREATE TABLE IF NOT EXISTS public.vihem_mail_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  mail_account_id uuid NOT NULL REFERENCES public.vihem_mail_accounts(id) ON DELETE CASCADE,
  gmail_message_id text NOT NULL,
  gmail_attachment_id text,
  filename text NOT NULL DEFAULT '',
  mime_type text NOT NULL DEFAULT 'application/octet-stream',
  document_id uuid REFERENCES public.vihem_documents(id) ON DELETE SET NULL,
  linked_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vihem_mail_links_org_idx
  ON public.vihem_mail_links (organisation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.vihem_mail_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('account_created','account_updated','account_deleted','connection_tested','search','message_read','attachment_downloaded','attachment_linked')),
  mail_account_id uuid REFERENCES public.vihem_mail_accounts(id) ON DELETE SET NULL,
  result text NOT NULL DEFAULT 'ok' CHECK (result IN ('ok','failed')),
  error_code text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vihem_mail_audit_org_idx
  ON public.vihem_mail_audit_events (organisation_id, created_at DESC);

ALTER TABLE public.vihem_mail_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_mail_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_mail_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM mail accounts read own organisation" ON public.vihem_mail_accounts;
CREATE POLICY "VIHEM mail accounts read own organisation"
  ON public.vihem_mail_accounts FOR SELECT TO authenticated
  USING (organisation_id = (SELECT p.organisation_id FROM public.vihem_profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS "VIHEM mail links read own organisation" ON public.vihem_mail_links;
CREATE POLICY "VIHEM mail links read own organisation"
  ON public.vihem_mail_links FOR SELECT TO authenticated
  USING (organisation_id = (SELECT p.organisation_id FROM public.vihem_profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS "VIHEM mail audit read own organisation" ON public.vihem_mail_audit_events;
CREATE POLICY "VIHEM mail audit read own organisation"
  ON public.vihem_mail_audit_events FOR SELECT TO authenticated
  USING (organisation_id = (SELECT p.organisation_id FROM public.vihem_profiles p WHERE p.id = auth.uid()));

REVOKE ALL ON public.vihem_mail_accounts, public.vihem_mail_links, public.vihem_mail_audit_events FROM anon;
GRANT SELECT ON public.vihem_mail_accounts, public.vihem_mail_links, public.vihem_mail_audit_events TO authenticated;
