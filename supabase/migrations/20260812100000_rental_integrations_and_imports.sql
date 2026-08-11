-- Adaptermetadata för uthyrning. Hemligheter ska lagras i Supabase secrets
-- eller befintlig server-side secret-hantering, aldrig i dessa publika rader.
CREATE TABLE IF NOT EXISTS public.vihem_rental_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  integration_type text NOT NULL CHECK (integration_type IN ('payment','access','public_api')),
  provider text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_ref text NOT NULL DEFAULT '',
  last_tested_at timestamptz,
  last_error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, integration_type, provider)
);

CREATE TABLE IF NOT EXISTS public.vihem_rental_import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'odoo',
  status text NOT NULL DEFAULT 'dry_run' CHECK (status IN ('dry_run','queued','running','completed','failed')),
  dry_run boolean NOT NULL DEFAULT true,
  source_checksum text NOT NULL DEFAULT '',
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.vihem_rental_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_run_id uuid NOT NULL REFERENCES public.vihem_rental_import_runs(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('product','asset','customer','booking','price')),
  external_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  target_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','created','updated','skipped','failed')),
  error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_run_id, entity_type, external_id)
);

ALTER TABLE public.vihem_rental_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_rental_import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_rental_import_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Rental integrations admin" ON public.vihem_rental_integrations;
CREATE POLICY "Rental integrations admin" ON public.vihem_rental_integrations FOR ALL TO authenticated
  USING (organisation_id = public.get_my_org_id() AND public.get_my_role() = 'admin' AND public.vihem_rental_enabled(organisation_id))
  WITH CHECK (organisation_id = public.get_my_org_id() AND public.get_my_role() = 'admin' AND public.vihem_rental_enabled(organisation_id));

DROP POLICY IF EXISTS "Rental import runs admin" ON public.vihem_rental_import_runs;
CREATE POLICY "Rental import runs admin" ON public.vihem_rental_import_runs FOR ALL TO authenticated
  USING (organisation_id = public.get_my_org_id() AND public.get_my_role() = 'admin' AND public.vihem_rental_enabled(organisation_id))
  WITH CHECK (organisation_id = public.get_my_org_id() AND public.get_my_role() = 'admin' AND public.vihem_rental_enabled(organisation_id));

DROP POLICY IF EXISTS "Rental import rows admin" ON public.vihem_rental_import_rows;
CREATE POLICY "Rental import rows admin" ON public.vihem_rental_import_rows FOR ALL TO authenticated
  USING (organisation_id = public.get_my_org_id() AND public.get_my_role() = 'admin' AND public.vihem_rental_enabled(organisation_id))
  WITH CHECK (organisation_id = public.get_my_org_id() AND public.get_my_role() = 'admin' AND public.vihem_rental_enabled(organisation_id));

NOTIFY pgrst, 'reload schema';
