-- Skatteverket: organisationens bolag, synkstatus, åtaganden och händelser.
-- Officiella myndighetsanrop görs först när OAuth/secrets är konfigurerade.

INSERT INTO public.vihem_module_registry (
  module_key, name, description, category, default_enabled, default_limits, default_settings, sort_order
)
VALUES (
  'skatteverket',
  'Skatteverket',
  'Översikt över skatteåtaganden, deklarationer, skattekonto och myndighetssynk.',
  'finance',
  false,
  '{"max_companies": 10, "sync_window_days": 90}'::jsonb,
  '{"attention_days": 14, "mode": "mock"}'::jsonb,
  95
)
ON CONFLICT (module_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  default_limits = EXCLUDED.default_limits,
  default_settings = EXCLUDED.default_settings,
  updated_at = now();

INSERT INTO public.vihem_organisation_modules (organisation_id, module_key, enabled, limits, settings)
SELECT o.id, 'skatteverket', false, r.default_limits, r.default_settings
FROM public.vihem_organisations o
JOIN public.vihem_module_registry r ON r.module_key = 'skatteverket'
ON CONFLICT (organisation_id, module_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.vihem_skatteverket_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.vihem_companies(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'skatteverket' CHECK (provider = 'skatteverket'),
  environment text NOT NULL DEFAULT 'test' CHECK (environment IN ('test', 'production')),
  mode text NOT NULL DEFAULT 'mock' CHECK (mode IN ('mock', 'oauth', 'certificate')),
  client_id text NOT NULL DEFAULT '',
  redirect_uri text NOT NULL DEFAULT '',
  scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  connected_at timestamptz,
  last_sync_at timestamptz,
  last_error text NOT NULL DEFAULT '',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, company_id)
);

CREATE TABLE IF NOT EXISTS public.vihem_tax_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.vihem_companies(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'skatteverket',
  obligation_type text NOT NULL CHECK (obligation_type IN ('vat', 'agi', 'income_tax', 'preliminary_tax', 'tax_account', 'other')),
  period text NOT NULL DEFAULT '',
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  due_at timestamptz,
  amount numeric(14,2),
  currency text NOT NULL DEFAULT 'SEK',
  official_status text NOT NULL DEFAULT 'unknown' CHECK (official_status IN ('unknown', 'open', 'submitted', 'received', 'paid', 'overdue')),
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'verified', 'warning', 'error')),
  task_status text NOT NULL DEFAULT 'open' CHECK (task_status IN ('open', 'in_progress', 'done', 'dismissed')),
  official_reference text NOT NULL DEFAULT '',
  source_updated_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, source, obligation_type, period)
);

CREATE TABLE IF NOT EXISTS public.vihem_tax_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.vihem_companies(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'skatteverket',
  event_type text NOT NULL DEFAULT 'notice',
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  event_at timestamptz NOT NULL DEFAULT now(),
  official_reference text NOT NULL DEFAULT '',
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, source, official_reference)
);

CREATE TABLE IF NOT EXISTS public.vihem_tax_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.vihem_companies(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'mock' CHECK (mode IN ('mock', 'oauth', 'certificate')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed')),
  obligations_seen integer NOT NULL DEFAULT 0,
  events_seen integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error_message text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vihem_skatteverket_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.vihem_companies(id) ON DELETE CASCADE,
  state_hash text NOT NULL UNIQUE,
  code_verifier text NOT NULL,
  redirect_uri text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vihem_tax_obligations_company_due_idx
  ON public.vihem_tax_obligations (company_id, due_at, task_status);
CREATE INDEX IF NOT EXISTS vihem_tax_obligations_org_idx
  ON public.vihem_tax_obligations (organisation_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS vihem_tax_events_company_date_idx
  ON public.vihem_tax_events (company_id, event_at DESC);
CREATE INDEX IF NOT EXISTS vihem_tax_sync_runs_company_date_idx
  ON public.vihem_tax_sync_runs (company_id, created_at DESC);

DO $$
BEGIN
  IF to_regprocedure('public.vihem_touch_updated_at()') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS vihem_skatteverket_integrations_updated_at ON public.vihem_skatteverket_integrations';
    EXECUTE 'CREATE TRIGGER vihem_skatteverket_integrations_updated_at BEFORE UPDATE ON public.vihem_skatteverket_integrations FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at()';
    EXECUTE 'DROP TRIGGER IF EXISTS vihem_tax_obligations_updated_at ON public.vihem_tax_obligations';
    EXECUTE 'CREATE TRIGGER vihem_tax_obligations_updated_at BEFORE UPDATE ON public.vihem_tax_obligations FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at()';
  END IF;
END $$;

ALTER TABLE public.vihem_skatteverket_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_tax_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_tax_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_tax_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_skatteverket_oauth_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Skatteverket integrations admin" ON public.vihem_skatteverket_integrations;
CREATE POLICY "Skatteverket integrations admin" ON public.vihem_skatteverket_integrations
  FOR ALL TO authenticated
  USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin', 'superadmin') AND public.vihem_module_enabled('skatteverket'))
  WITH CHECK (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin', 'superadmin') AND public.vihem_module_enabled('skatteverket'));

DROP POLICY IF EXISTS "Skatteverket obligations company read" ON public.vihem_tax_obligations;
CREATE POLICY "Skatteverket obligations company read" ON public.vihem_tax_obligations
  FOR SELECT TO authenticated
  USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin', 'superadmin') AND public.vihem_module_enabled('skatteverket') AND public.vihem_user_has_company_access(company_id, 'viewer'));
DROP POLICY IF EXISTS "Skatteverket obligations admin write" ON public.vihem_tax_obligations;
CREATE POLICY "Skatteverket obligations admin write" ON public.vihem_tax_obligations
  FOR ALL TO authenticated
  USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin', 'superadmin') AND public.vihem_module_enabled('skatteverket'))
  WITH CHECK (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin', 'superadmin') AND public.vihem_module_enabled('skatteverket'));

DROP POLICY IF EXISTS "Skatteverket events company read" ON public.vihem_tax_events;
CREATE POLICY "Skatteverket events company read" ON public.vihem_tax_events
  FOR SELECT TO authenticated
  USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin', 'superadmin') AND public.vihem_module_enabled('skatteverket') AND public.vihem_user_has_company_access(company_id, 'viewer'));
DROP POLICY IF EXISTS "Skatteverket events admin write" ON public.vihem_tax_events;
CREATE POLICY "Skatteverket events admin write" ON public.vihem_tax_events
  FOR ALL TO authenticated
  USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin', 'superadmin') AND public.vihem_module_enabled('skatteverket'))
  WITH CHECK (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin', 'superadmin') AND public.vihem_module_enabled('skatteverket'));

DROP POLICY IF EXISTS "Skatteverket sync runs admin" ON public.vihem_tax_sync_runs;
CREATE POLICY "Skatteverket sync runs admin" ON public.vihem_tax_sync_runs
  FOR ALL TO authenticated
  USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin', 'superadmin') AND public.vihem_module_enabled('skatteverket'))
  WITH CHECK (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin', 'superadmin') AND public.vihem_module_enabled('skatteverket'));

DROP POLICY IF EXISTS "Skatteverket oauth admin" ON public.vihem_skatteverket_oauth_states;
CREATE POLICY "Skatteverket oauth admin" ON public.vihem_skatteverket_oauth_states
  FOR ALL TO authenticated
  USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin', 'superadmin') AND public.vihem_module_enabled('skatteverket'))
  WITH CHECK (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin', 'superadmin') AND public.vihem_module_enabled('skatteverket'));

NOTIFY pgrst, 'reload schema';
