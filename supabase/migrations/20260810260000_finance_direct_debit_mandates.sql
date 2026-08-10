CREATE TABLE IF NOT EXISTS public.vihem_direct_debit_mandates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.vihem_companies(id) ON DELETE RESTRICT,
  tenancy_id uuid NOT NULL REFERENCES public.vihem_tenancies(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  finance_customer_id uuid REFERENCES public.vihem_finance_customers(id) ON DELETE SET NULL,
  mandate_reference text NOT NULL DEFAULT '',
  bankgiro_number text NOT NULL DEFAULT '',
  payer_number text NOT NULL DEFAULT '',
  account_holder text NOT NULL DEFAULT '',
  account_mask text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_signature', 'active', 'paused', 'cancelled', 'rejected')),
  signed_at timestamptz,
  activated_at timestamptz,
  cancelled_at timestamptz,
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenancy_id)
);

CREATE INDEX IF NOT EXISTS vihem_direct_debit_mandates_org_status_idx
  ON public.vihem_direct_debit_mandates (organisation_id, status);
CREATE INDEX IF NOT EXISTS vihem_direct_debit_mandates_company_idx
  ON public.vihem_direct_debit_mandates (company_id);

ALTER TABLE public.vihem_direct_debit_mandates ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS vihem_touch_updated_at_trigger ON public.vihem_direct_debit_mandates;
CREATE TRIGGER vihem_touch_updated_at_trigger
  BEFORE UPDATE ON public.vihem_direct_debit_mandates
  FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at();

DROP TRIGGER IF EXISTS vihem_finance_audit_trigger ON public.vihem_direct_debit_mandates;
CREATE TRIGGER vihem_finance_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.vihem_direct_debit_mandates
  FOR EACH ROW EXECUTE FUNCTION public.vihem_finance_audit_trigger();

DROP POLICY IF EXISTS "VIHEM direct debit mandates read" ON public.vihem_direct_debit_mandates;
CREATE POLICY "VIHEM direct debit mandates read"
  ON public.vihem_direct_debit_mandates FOR SELECT TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_user_has_company_access(company_id, 'viewer')
    )
  );

DROP POLICY IF EXISTS "VIHEM direct debit mandates insert" ON public.vihem_direct_debit_mandates;
CREATE POLICY "VIHEM direct debit mandates insert"
  ON public.vihem_direct_debit_mandates FOR INSERT TO authenticated
  WITH CHECK (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_user_has_company_access(company_id, 'seller')
    )
  );

DROP POLICY IF EXISTS "VIHEM direct debit mandates update" ON public.vihem_direct_debit_mandates;
CREATE POLICY "VIHEM direct debit mandates update"
  ON public.vihem_direct_debit_mandates FOR UPDATE TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_user_has_company_access(company_id, 'seller')
    )
  )
  WITH CHECK (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_user_has_company_access(company_id, 'seller')
    )
  );

CREATE OR REPLACE FUNCTION public.vihem_set_direct_debit_mandate_status(
  target_mandate_id uuid,
  next_status text
)
RETURNS public.vihem_direct_debit_mandates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mandate_row public.vihem_direct_debit_mandates%ROWTYPE;
BEGIN
  IF next_status NOT IN ('draft', 'pending_signature', 'active', 'paused', 'cancelled', 'rejected') THEN
    RAISE EXCEPTION 'Invalid direct debit mandate status';
  END IF;

  SELECT *
  INTO mandate_row
  FROM public.vihem_direct_debit_mandates
  WHERE id = target_mandate_id
  FOR UPDATE;

  IF mandate_row.id IS NULL THEN
    RAISE EXCEPTION 'Direct debit mandate not found';
  END IF;

  IF NOT public.vihem_user_has_company_access(mandate_row.company_id, 'seller') THEN
    RAISE EXCEPTION 'Not allowed to update direct debit mandate';
  END IF;

  UPDATE public.vihem_direct_debit_mandates
  SET
    status = next_status,
    signed_at = CASE WHEN next_status IN ('active', 'pending_signature') AND signed_at IS NULL THEN now() ELSE signed_at END,
    activated_at = CASE WHEN next_status = 'active' THEN COALESCE(activated_at, now()) ELSE activated_at END,
    cancelled_at = CASE WHEN next_status IN ('cancelled', 'rejected') THEN COALESCE(cancelled_at, now()) ELSE cancelled_at END,
    updated_at = now()
  WHERE id = target_mandate_id
  RETURNING * INTO mandate_row;

  RETURN mandate_row;
END;
$$;

NOTIFY pgrst, 'reload schema';
