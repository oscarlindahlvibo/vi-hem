/*
  # VI-HEM accounting integration secrets

  Stores encrypted accounting adapter secrets outside the public integration
  config. Client-side reads and writes are intentionally blocked by RLS; edge
  functions with service role handle writes after checking the user's company
  permissions.
*/

CREATE TABLE IF NOT EXISTS public.vihem_accounting_integration_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.vihem_companies(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.vihem_accounting_integrations(id) ON DELETE CASCADE,
  provider text NOT NULL,
  secret_name text NOT NULL DEFAULT 'primary_token',
  encrypted_secret text NOT NULL DEFAULT '',
  secret_hint text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  rotated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (integration_id, secret_name)
);

CREATE INDEX IF NOT EXISTS vihem_accounting_integration_secrets_company_idx
  ON public.vihem_accounting_integration_secrets (company_id, provider);

ALTER TABLE public.vihem_accounting_integration_secrets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM accounting integration secrets blocked" ON public.vihem_accounting_integration_secrets;
CREATE POLICY "VIHEM accounting integration secrets blocked"
  ON public.vihem_accounting_integration_secrets FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

DROP TRIGGER IF EXISTS vihem_touch_updated_at_trigger ON public.vihem_accounting_integration_secrets;
CREATE TRIGGER vihem_touch_updated_at_trigger
  BEFORE UPDATE ON public.vihem_accounting_integration_secrets
  FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at();

NOTIFY pgrst, 'reload schema';
