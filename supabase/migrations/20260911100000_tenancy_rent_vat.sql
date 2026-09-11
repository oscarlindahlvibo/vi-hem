ALTER TABLE public.vihem_tenancies
  ADD COLUMN IF NOT EXISTS rent_vat_rate numeric(5,2) NOT NULL DEFAULT 0;

-- Rent is normally VAT-exempt in Sweden, but a landlord can opt into charging
-- VAT on rent for a lease with a VAT-registered company tenant ("frivillig
-- skattskyldighet för moms"). vihem_create_rent_billing_run previously
-- hardcoded vat_rate/vat_amount to 0 for every draft rent billing item --
-- this makes it honour the tenancy's own rent_vat_rate instead, defaulting
-- to 0 (unchanged behaviour) unless a tenancy explicitly opts in.
CREATE OR REPLACE FUNCTION public.vihem_create_rent_billing_run(
  target_company_id uuid,
  target_rent_period date,
  include_existing boolean DEFAULT false
)
RETURNS public.vihem_rent_billing_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  company_row public.vihem_companies%ROWTYPE;
  run_row public.vihem_rent_billing_runs%ROWTYPE;
  normalized_period date;
  calculated_due date;
BEGIN
  SELECT *
  INTO company_row
  FROM public.vihem_companies
  WHERE id = target_company_id;

  IF company_row.id IS NULL THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  IF NOT public.vihem_user_has_company_access(target_company_id, 'seller') THEN
    RAISE EXCEPTION 'Not allowed to create rent billing run';
  END IF;

  normalized_period := date_trunc('month', target_rent_period)::date;
  calculated_due := public.vihem_rent_due_date(normalized_period);

  INSERT INTO public.vihem_rent_billing_runs (
    organisation_id,
    company_id,
    rent_period,
    due_date,
    status,
    created_by
  )
  VALUES (
    company_row.organisation_id,
    company_row.id,
    normalized_period,
    calculated_due,
    'draft',
    auth.uid()
  )
  ON CONFLICT (company_id, rent_period) DO UPDATE
  SET updated_at = now()
  RETURNING * INTO run_row;

  INSERT INTO public.vihem_rent_billing_items (
    organisation_id,
    company_id,
    run_id,
    tenancy_id,
    tenant_id,
    property_id,
    apartment_id,
    finance_customer_id,
    rent_period,
    due_date,
    description,
    amount,
    vat_rate,
    vat_amount,
    total_amount,
    status
  )
  SELECT
    calc.organisation_id,
    company_row.id,
    run_row.id,
    calc.tenancy_id,
    calc.tenant_id,
    calc.property_id,
    calc.apartment_id,
    public.vihem_ensure_finance_customer_for_tenant(calc.organisation_id, company_row.id, calc.tenant_id),
    normalized_period,
    calculated_due,
    'Hyra ' || to_char(normalized_period, 'YYYY-MM'),
    calc.base_amount,
    calc.vat_rate,
    round(calc.base_amount * calc.vat_rate / 100, 2),
    calc.base_amount + round(calc.base_amount * calc.vat_rate / 100, 2),
    'draft'
  FROM (
    SELECT
      t.id AS tenancy_id,
      t.organisation_id,
      t.tenant_id,
      t.property_id,
      t.apartment_id,
      t.start_date,
      t.end_date,
      t.status,
      t.company_id,
      a.company_id AS apartment_company_id,
      COALESCE(NULLIF(t.monthly_rent, 0), a.rent, 0) AS base_amount,
      COALESCE(t.rent_vat_rate, 0) AS vat_rate
    FROM public.vihem_tenancies t
    JOIN public.vihem_apartments a ON a.id = t.apartment_id
  ) calc
  WHERE calc.organisation_id = company_row.organisation_id
    AND COALESCE(calc.company_id, calc.apartment_company_id, company_row.id) = company_row.id
    AND calc.status = 'active'
    AND calc.start_date <= normalized_period
    AND (calc.end_date IS NULL OR calc.end_date >= normalized_period)
    AND (include_existing OR NOT EXISTS (
      SELECT 1
      FROM public.vihem_rent_billing_items existing
      WHERE existing.tenancy_id = calc.tenancy_id
        AND existing.rent_period = normalized_period
    ))
  ON CONFLICT (tenancy_id, rent_period) DO NOTHING;

  UPDATE public.vihem_rent_billing_runs
  SET
    invoice_count = (
      SELECT COUNT(*) FROM public.vihem_rent_billing_items WHERE run_id = run_row.id AND status IN ('draft', 'invoiced')
    ),
    total_amount = (
      SELECT COALESCE(SUM(total_amount), 0) FROM public.vihem_rent_billing_items WHERE run_id = run_row.id AND status IN ('draft', 'invoiced')
    ),
    status = 'draft',
    updated_at = now()
  WHERE id = run_row.id
  RETURNING * INTO run_row;

  RETURN run_row;
END;
$$;
