/*
  # VI-HEM finance phase 4

  Adds rent billing runs and invoice generation from active tenancies.
  Rent is due on the last day of the month before the rent period.
*/

ALTER TABLE public.vihem_invoice_lines
  ADD COLUMN IF NOT EXISTS tenancy_id uuid REFERENCES public.vihem_tenancies(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.vihem_rent_billing_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.vihem_companies(id) ON DELETE RESTRICT,
  rent_period date NOT NULL,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'generated', 'approved', 'sent', 'cancelled')),
  invoice_count integer NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, rent_period)
);

CREATE INDEX IF NOT EXISTS vihem_rent_billing_runs_org_idx
  ON public.vihem_rent_billing_runs (organisation_id, rent_period DESC);

CREATE TABLE IF NOT EXISTS public.vihem_rent_billing_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.vihem_companies(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL REFERENCES public.vihem_rent_billing_runs(id) ON DELETE CASCADE,
  tenancy_id uuid NOT NULL REFERENCES public.vihem_tenancies(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES public.vihem_profiles(id) ON DELETE RESTRICT,
  property_id uuid REFERENCES public.vihem_properties(id) ON DELETE SET NULL,
  apartment_id uuid REFERENCES public.vihem_apartments(id) ON DELETE SET NULL,
  finance_customer_id uuid REFERENCES public.vihem_finance_customers(id) ON DELETE SET NULL,
  invoice_id uuid REFERENCES public.vihem_invoices(id) ON DELETE SET NULL,
  rent_period date NOT NULL,
  due_date date NOT NULL,
  description text NOT NULL DEFAULT '',
  amount numeric(14,2) NOT NULL DEFAULT 0,
  vat_rate numeric(6,2) NOT NULL DEFAULT 0,
  vat_amount numeric(14,2) NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'invoiced', 'skipped', 'cancelled')),
  skip_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenancy_id, rent_period)
);

CREATE INDEX IF NOT EXISTS vihem_rent_billing_items_run_idx
  ON public.vihem_rent_billing_items (run_id);
CREATE INDEX IF NOT EXISTS vihem_rent_billing_items_invoice_idx
  ON public.vihem_rent_billing_items (invoice_id);

ALTER TABLE public.vihem_rent_billing_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_rent_billing_items ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.vihem_rent_due_date(rent_period date)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (date_trunc('month', rent_period)::date - 1);
$$;

CREATE OR REPLACE FUNCTION public.vihem_ensure_finance_customer_for_tenant(
  target_organisation_id uuid,
  target_company_id uuid,
  target_tenant_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tenant_row public.vihem_profiles%ROWTYPE;
  customer_id uuid;
BEGIN
  SELECT *
  INTO tenant_row
  FROM public.vihem_profiles
  WHERE id = target_tenant_id;

  IF tenant_row.id IS NULL THEN
    RAISE EXCEPTION 'Tenant not found';
  END IF;

  SELECT id
  INTO customer_id
  FROM public.vihem_finance_customers
  WHERE organisation_id = target_organisation_id
    AND (company_id = target_company_id OR company_id IS NULL)
    AND customer_type = 'private'
    AND email = tenant_row.email
  ORDER BY
    CASE WHEN company_id = target_company_id THEN 0 ELSE 1 END,
    created_at
  LIMIT 1;

  IF customer_id IS NULL THEN
    INSERT INTO public.vihem_finance_customers (
      organisation_id,
      company_id,
      customer_type,
      name,
      email,
      invoice_email,
      payment_terms_days,
      created_by
    )
    VALUES (
      target_organisation_id,
      target_company_id,
      'private',
      tenant_row.name,
      tenant_row.email,
      tenant_row.email,
      0,
      auth.uid()
    )
    RETURNING id INTO customer_id;
  END IF;

  RETURN customer_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.vihem_recalculate_rent_billing_run(target_run_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.vihem_rent_billing_runs
  SET
    invoice_count = (
      SELECT COUNT(*)
      FROM public.vihem_rent_billing_items
      WHERE run_id = target_run_id
        AND status IN ('draft', 'invoiced')
    ),
    total_amount = (
      SELECT COALESCE(SUM(total_amount), 0)
      FROM public.vihem_rent_billing_items
      WHERE run_id = target_run_id
        AND status IN ('draft', 'invoiced')
    ),
    updated_at = now()
  WHERE id = target_run_id;
$$;

CREATE OR REPLACE FUNCTION public.vihem_rent_billing_items_recalculate_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.vihem_recalculate_rent_billing_run(OLD.run_id);
    RETURN OLD;
  END IF;

  PERFORM public.vihem_recalculate_rent_billing_run(NEW.run_id);

  IF TG_OP = 'UPDATE' AND OLD.run_id IS DISTINCT FROM NEW.run_id THEN
    PERFORM public.vihem_recalculate_rent_billing_run(OLD.run_id);
  END IF;

  RETURN NEW;
END;
$$;

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
    t.organisation_id,
    company_row.id,
    run_row.id,
    t.id,
    t.tenant_id,
    t.property_id,
    t.apartment_id,
    public.vihem_ensure_finance_customer_for_tenant(t.organisation_id, company_row.id, t.tenant_id),
    normalized_period,
    calculated_due,
    'Hyra ' || to_char(normalized_period, 'YYYY-MM'),
    COALESCE(NULLIF(t.monthly_rent, 0), a.rent, 0),
    0,
    0,
    COALESCE(NULLIF(t.monthly_rent, 0), a.rent, 0),
    'draft'
  FROM public.vihem_tenancies t
  JOIN public.vihem_apartments a ON a.id = t.apartment_id
  WHERE t.organisation_id = company_row.organisation_id
    AND COALESCE(t.company_id, a.company_id, company_row.id) = company_row.id
    AND t.status = 'active'
    AND t.start_date <= normalized_period
    AND (t.end_date IS NULL OR t.end_date >= normalized_period)
    AND (include_existing OR NOT EXISTS (
      SELECT 1
      FROM public.vihem_rent_billing_items existing
      WHERE existing.tenancy_id = t.id
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

CREATE OR REPLACE FUNCTION public.vihem_generate_rent_invoices(target_run_id uuid)
RETURNS public.vihem_rent_billing_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  run_row public.vihem_rent_billing_runs%ROWTYPE;
  item_row public.vihem_rent_billing_items%ROWTYPE;
  invoice_row public.vihem_invoices%ROWTYPE;
BEGIN
  SELECT *
  INTO run_row
  FROM public.vihem_rent_billing_runs
  WHERE id = target_run_id
  FOR UPDATE;

  IF run_row.id IS NULL THEN
    RAISE EXCEPTION 'Rent billing run not found';
  END IF;

  IF NOT public.vihem_user_has_company_access(run_row.company_id, 'seller') THEN
    RAISE EXCEPTION 'Not allowed to generate rent invoices';
  END IF;

  FOR item_row IN
    SELECT *
    FROM public.vihem_rent_billing_items
    WHERE run_id = run_row.id
      AND status = 'draft'
      AND invoice_id IS NULL
      AND total_amount > 0
    ORDER BY created_at
  LOOP
    INSERT INTO public.vihem_invoices (
      organisation_id,
      company_id,
      customer_id,
      invoice_date,
      due_date,
      payment_terms_days,
      status,
      source_type,
      source_id,
      tenancy_id,
      subtotal_amount,
      vat_amount,
      total_amount,
      notes,
      created_by
    )
    VALUES (
      item_row.organisation_id,
      item_row.company_id,
      item_row.finance_customer_id,
      CURRENT_DATE,
      item_row.due_date,
      0,
      'draft',
      'rent_billing',
      item_row.id,
      item_row.tenancy_id,
      item_row.amount,
      item_row.vat_amount,
      item_row.total_amount,
      'Hyresdebitering för ' || to_char(item_row.rent_period, 'YYYY-MM'),
      auth.uid()
    )
    RETURNING * INTO invoice_row;

    INSERT INTO public.vihem_invoice_lines (
      organisation_id,
      company_id,
      invoice_id,
      line_no,
      description,
      quantity,
      unit,
      unit_price,
      vat_rate,
      line_type,
      tenancy_id,
      line_total_excl_vat,
      vat_amount,
      line_total_incl_vat,
      metadata
    )
    VALUES (
      item_row.organisation_id,
      item_row.company_id,
      invoice_row.id,
      1,
      item_row.description,
      1,
      'månad',
      item_row.amount,
      item_row.vat_rate,
      'rent',
      item_row.tenancy_id,
      item_row.amount,
      item_row.vat_amount,
      item_row.total_amount,
      jsonb_build_object('rent_billing_item_id', item_row.id, 'rent_period', item_row.rent_period)
    );

    UPDATE public.vihem_rent_billing_items
    SET
      invoice_id = invoice_row.id,
      status = 'invoiced',
      updated_at = now()
    WHERE id = item_row.id;
  END LOOP;

  UPDATE public.vihem_rent_billing_runs
  SET
    status = 'generated',
    invoice_count = (
      SELECT COUNT(*) FROM public.vihem_rent_billing_items WHERE run_id = run_row.id AND invoice_id IS NOT NULL
    ),
    total_amount = (
      SELECT COALESCE(SUM(total_amount), 0) FROM public.vihem_rent_billing_items WHERE run_id = run_row.id AND status IN ('draft', 'invoiced')
    ),
    updated_at = now()
  WHERE id = run_row.id
  RETURNING * INTO run_row;

  RETURN run_row;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'vihem_rent_billing_runs',
    'vihem_rent_billing_items'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS vihem_touch_updated_at_trigger ON public.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER vihem_touch_updated_at_trigger BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at()',
      table_name
    );

    EXECUTE format('DROP TRIGGER IF EXISTS vihem_finance_audit_trigger ON public.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER vihem_finance_audit_trigger AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.vihem_finance_audit_trigger()',
      table_name
    );
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS vihem_rent_billing_items_recalculate_trigger ON public.vihem_rent_billing_items;
CREATE TRIGGER vihem_rent_billing_items_recalculate_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.vihem_rent_billing_items
  FOR EACH ROW EXECUTE FUNCTION public.vihem_rent_billing_items_recalculate_trigger();

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'vihem_rent_billing_runs',
    'vihem_rent_billing_items'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "VIHEM finance rent scoped read" ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY "VIHEM finance rent scoped read" ON public.%I FOR SELECT TO authenticated USING (public.vihem_get_my_role() = ''superadmin'' OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_user_has_company_access(company_id, ''viewer'')))',
      table_name
    );

    EXECUTE format('DROP POLICY IF EXISTS "VIHEM finance rent scoped insert" ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY "VIHEM finance rent scoped insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.vihem_get_my_role() = ''superadmin'' OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_user_has_company_access(company_id, ''seller'')))',
      table_name
    );

    EXECUTE format('DROP POLICY IF EXISTS "VIHEM finance rent scoped update" ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY "VIHEM finance rent scoped update" ON public.%I FOR UPDATE TO authenticated USING (public.vihem_get_my_role() = ''superadmin'' OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_user_has_company_access(company_id, ''seller''))) WITH CHECK (public.vihem_get_my_role() = ''superadmin'' OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_user_has_company_access(company_id, ''seller'')))',
      table_name
    );

    EXECUTE format('DROP POLICY IF EXISTS "VIHEM finance rent scoped delete" ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY "VIHEM finance rent scoped delete" ON public.%I FOR DELETE TO authenticated USING (public.vihem_get_my_role() = ''superadmin'' OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_user_has_company_access(company_id, ''admin'')))',
      table_name
    );
  END LOOP;
END $$;
