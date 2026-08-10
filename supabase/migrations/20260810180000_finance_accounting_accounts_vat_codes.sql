/*
  # VI-HEM accounting accounts and VAT codes

  Adds company-scoped chart-of-account and VAT-code settings so exports can
  move away from hard-coded fallback accounts.
*/

CREATE TABLE IF NOT EXISTS public.vihem_accounting_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.vihem_companies(id) ON DELETE CASCADE,
  account_code text NOT NULL,
  name text NOT NULL,
  account_type text NOT NULL DEFAULT 'other'
    CHECK (account_type IN ('asset', 'liability', 'income', 'expense', 'vat', 'bank', 'receivable', 'payable', 'other')),
  default_role text NOT NULL DEFAULT ''
    CHECK (default_role IN ('', 'customer_receivable', 'supplier_payable', 'bank', 'sales', 'purchase', 'output_vat', 'input_vat')),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, account_code)
);

CREATE TABLE IF NOT EXISTS public.vihem_vat_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.vihem_companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  rate numeric(6,2) NOT NULL DEFAULT 25 CHECK (rate >= 0),
  sales_account_code text NOT NULL DEFAULT '',
  purchase_account_code text NOT NULL DEFAULT '',
  output_vat_account_code text NOT NULL DEFAULT '',
  input_vat_account_code text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE INDEX IF NOT EXISTS vihem_accounting_accounts_company_idx
  ON public.vihem_accounting_accounts (company_id, active, account_code);

CREATE UNIQUE INDEX IF NOT EXISTS vihem_accounting_accounts_company_default_role_unique
  ON public.vihem_accounting_accounts (company_id, default_role)
  WHERE default_role <> '';

CREATE INDEX IF NOT EXISTS vihem_vat_codes_company_idx
  ON public.vihem_vat_codes (company_id, active, rate);

ALTER TABLE public.vihem_accounting_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_vat_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM accounting accounts read" ON public.vihem_accounting_accounts;
CREATE POLICY "VIHEM accounting accounts read"
  ON public.vihem_accounting_accounts FOR SELECT TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_user_has_company_access(company_id, 'viewer')
    )
  );

DROP POLICY IF EXISTS "VIHEM accounting accounts write" ON public.vihem_accounting_accounts;
CREATE POLICY "VIHEM accounting accounts write"
  ON public.vihem_accounting_accounts FOR ALL TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_user_has_company_access(company_id, 'bookkeeper')
    )
  )
  WITH CHECK (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_user_has_company_access(company_id, 'bookkeeper')
    )
  );

DROP POLICY IF EXISTS "VIHEM vat codes read" ON public.vihem_vat_codes;
CREATE POLICY "VIHEM vat codes read"
  ON public.vihem_vat_codes FOR SELECT TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_user_has_company_access(company_id, 'viewer')
    )
  );

DROP POLICY IF EXISTS "VIHEM vat codes write" ON public.vihem_vat_codes;
CREATE POLICY "VIHEM vat codes write"
  ON public.vihem_vat_codes FOR ALL TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_user_has_company_access(company_id, 'bookkeeper')
    )
  )
  WITH CHECK (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_user_has_company_access(company_id, 'bookkeeper')
    )
  );

DROP TRIGGER IF EXISTS vihem_touch_updated_at_trigger ON public.vihem_accounting_accounts;
CREATE TRIGGER vihem_touch_updated_at_trigger
  BEFORE UPDATE ON public.vihem_accounting_accounts
  FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at();

DROP TRIGGER IF EXISTS vihem_touch_updated_at_trigger ON public.vihem_vat_codes;
CREATE TRIGGER vihem_touch_updated_at_trigger
  BEFORE UPDATE ON public.vihem_vat_codes
  FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at();

NOTIFY pgrst, 'reload schema';
