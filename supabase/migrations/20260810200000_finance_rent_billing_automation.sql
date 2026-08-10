/*
  # VI-HEM finance rent billing automation

  Adds organisation-level settings and a service-role friendly RPC for creating
  recurring rent billing runs from finance cron.
*/

ALTER TABLE public.vihem_finance_automation_settings
  ADD COLUMN IF NOT EXISTS create_rent_billing boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rent_billing_months_ahead integer NOT NULL DEFAULT 1
    CHECK (rent_billing_months_ahead BETWEEN 0 AND 12),
  ADD COLUMN IF NOT EXISTS auto_generate_rent_invoices boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.vihem_generate_rent_invoices_system(target_run_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  run_row public.vihem_rent_billing_runs%ROWTYPE;
  item_row public.vihem_rent_billing_items%ROWTYPE;
  invoice_row public.vihem_invoices%ROWTYPE;
  generated_count integer := 0;
BEGIN
  SELECT *
  INTO run_row
  FROM public.vihem_rent_billing_runs
  WHERE id = target_run_id
  FOR UPDATE;

  IF run_row.id IS NULL THEN
    RAISE EXCEPTION 'Rent billing run not found';
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
      NULL
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
      jsonb_build_object('rent_billing_item_id', item_row.id, 'rent_period', item_row.rent_period, 'created_by', 'finance_cron')
    );

    UPDATE public.vihem_rent_billing_items
    SET
      invoice_id = invoice_row.id,
      status = 'invoiced',
      updated_at = now()
    WHERE id = item_row.id;

    generated_count := generated_count + 1;
  END LOOP;

  UPDATE public.vihem_rent_billing_runs
  SET
    status = CASE WHEN generated_count > 0 OR EXISTS (
      SELECT 1 FROM public.vihem_rent_billing_items WHERE run_id = run_row.id AND invoice_id IS NOT NULL
    ) THEN 'generated' ELSE status END,
    invoice_count = (
      SELECT COUNT(*) FROM public.vihem_rent_billing_items WHERE run_id = run_row.id AND invoice_id IS NOT NULL
    ),
    total_amount = (
      SELECT COALESCE(SUM(total_amount), 0)
      FROM public.vihem_rent_billing_items
      WHERE run_id = run_row.id
        AND status IN ('draft', 'invoiced')
    ),
    updated_at = now()
  WHERE id = run_row.id;

  RETURN generated_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.vihem_run_rent_billing_automation(
  target_organisation_id uuid,
  target_months_ahead integer DEFAULT 1,
  generate_invoice_drafts boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  company_row public.vihem_companies%ROWTYPE;
  run_row public.vihem_rent_billing_runs%ROWTYPE;
  normalized_period date;
  calculated_due date;
  created_runs integer := 0;
  touched_runs integer := 0;
  created_items integer := 0;
  generated_invoices integer := 0;
  inserted_items integer := 0;
  run_already_exists boolean;
BEGIN
  IF target_organisation_id IS NULL THEN
    RAISE EXCEPTION 'organisation_id is required for rent billing automation';
  END IF;

  normalized_period := date_trunc('month', CURRENT_DATE + (LEAST(GREATEST(target_months_ahead, 0), 12) || ' months')::interval)::date;
  calculated_due := public.vihem_rent_due_date(normalized_period);

  FOR company_row IN
    SELECT *
    FROM public.vihem_companies
    WHERE organisation_id = target_organisation_id
      AND active = true
    ORDER BY name
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM public.vihem_rent_billing_runs
      WHERE company_id = company_row.id
        AND rent_period = normalized_period
    )
    INTO run_already_exists;

    INSERT INTO public.vihem_rent_billing_runs (
      organisation_id,
      company_id,
      rent_period,
      due_date,
      status,
      notes,
      created_by
    )
    VALUES (
      company_row.organisation_id,
      company_row.id,
      normalized_period,
      calculated_due,
      'draft',
      'Skapad av ekonomi-cron',
      NULL
    )
    ON CONFLICT (company_id, rent_period) DO UPDATE
    SET
      due_date = EXCLUDED.due_date,
      updated_at = now()
    RETURNING * INTO run_row;

    touched_runs := touched_runs + 1;
    IF NOT run_already_exists THEN
      created_runs := created_runs + 1;
    END IF;

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
      AND NOT EXISTS (
        SELECT 1
        FROM public.vihem_rent_billing_items existing
        WHERE existing.tenancy_id = t.id
          AND existing.rent_period = normalized_period
      )
    ON CONFLICT (tenancy_id, rent_period) DO NOTHING;

    GET DIAGNOSTICS inserted_items = ROW_COUNT;
    created_items := created_items + inserted_items;

    PERFORM public.vihem_recalculate_rent_billing_run(run_row.id);

    IF generate_invoice_drafts THEN
      generated_invoices := generated_invoices + public.vihem_generate_rent_invoices_system(run_row.id);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'rent_period', normalized_period,
    'due_date', calculated_due,
    'companies_processed', touched_runs,
    'created_runs', created_runs,
    'created_items', created_items,
    'generated_invoices', generated_invoices
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
