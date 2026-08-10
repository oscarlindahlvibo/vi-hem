CREATE OR REPLACE FUNCTION public.vihem_create_invoice_from_project_basis_batch(
  target_basis_ids uuid[],
  target_company_id uuid,
  target_customer_id uuid DEFAULT NULL,
  invoice_date date DEFAULT CURRENT_DATE,
  due_date date DEFAULT NULL
)
RETURNS public.vihem_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  first_basis_row public.vihem_project_invoice_basis%ROWTYPE;
  first_project_row public.vihem_customer_projects%ROWTYPE;
  customer_row public.vihem_finance_customers%ROWTYPE;
  invoice_row public.vihem_invoices%ROWTYPE;
  calculated_due date;
  resolved_customer_id uuid;
  basis_count integer;
  distinct_org_count integer;
  distinct_project_count integer;
  distinct_customer_count integer;
  subtotal numeric(14,2);
  vat_total numeric(14,2);
BEGIN
  IF target_basis_ids IS NULL OR array_length(target_basis_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No project invoice basis selected';
  END IF;

  IF NOT public.vihem_user_has_company_access(target_company_id, 'seller') THEN
    RAISE EXCEPTION 'Not allowed to create invoice';
  END IF;

  SELECT *
  INTO first_basis_row
  FROM public.vihem_project_invoice_basis
  WHERE id = target_basis_ids[1]
  FOR UPDATE;

  IF first_basis_row.id IS NULL THEN
    RAISE EXCEPTION 'Project invoice basis not found';
  END IF;

  SELECT *
  INTO first_project_row
  FROM public.vihem_customer_projects
  WHERE id = first_basis_row.project_id;

  IF first_project_row.id IS NULL THEN
    RAISE EXCEPTION 'Project not found';
  END IF;

  SELECT
    count(*),
    count(DISTINCT cp.organisation_id),
    count(DISTINCT b.project_id),
    round(sum(b.total_amount)::numeric, 2),
    round(sum(b.vat_amount)::numeric, 2)
  INTO basis_count, distinct_org_count, distinct_project_count, subtotal, vat_total
  FROM public.vihem_project_invoice_basis b
  JOIN public.vihem_customer_projects cp ON cp.id = b.project_id
  WHERE b.id = ANY(target_basis_ids)
    AND b.status <> 'invoiced'
    AND b.finance_invoice_id IS NULL;

  IF basis_count <> array_length(target_basis_ids, 1) THEN
    RAISE EXCEPTION 'One or more selected project invoice basis rows are missing or already invoiced';
  END IF;

  IF distinct_org_count <> 1 THEN
    RAISE EXCEPTION 'Selected project invoice basis rows must belong to the same organisation';
  END IF;

  IF target_customer_id IS NULL THEN
    SELECT count(DISTINCT lower(trim(COALESCE(NULLIF(pc.email, ''), NULLIF(pc.name, ''), NULLIF(cp.customer_name, ''), cp.id::text))))
    INTO distinct_customer_count
    FROM public.vihem_project_invoice_basis b
    JOIN public.vihem_customer_projects cp ON cp.id = b.project_id
    LEFT JOIN public.vihem_project_customers pc ON pc.id = cp.customer_id
    WHERE b.id = ANY(target_basis_ids);

    IF distinct_customer_count > 1 THEN
      RAISE EXCEPTION 'Selected project invoice basis rows must belong to the same customer when no finance customer is selected';
    END IF;
  END IF;

  resolved_customer_id := COALESCE(
    target_customer_id,
    public.vihem_ensure_finance_customer_for_project(first_project_row.organisation_id, target_company_id, first_project_row.id)
  );

  SELECT *
  INTO customer_row
  FROM public.vihem_finance_customers
  WHERE id = resolved_customer_id
    AND organisation_id = first_project_row.organisation_id;

  IF customer_row.id IS NULL THEN
    RAISE EXCEPTION 'Finance customer not found';
  END IF;

  calculated_due := COALESCE(due_date, invoice_date + customer_row.payment_terms_days);

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
    project_id,
    subtotal_amount,
    vat_amount,
    total_amount,
    notes,
    created_by
  )
  VALUES (
    first_project_row.organisation_id,
    target_company_id,
    resolved_customer_id,
    invoice_date,
    calculated_due,
    customer_row.payment_terms_days,
    'draft',
    'project_invoice_basis_batch',
    first_basis_row.id,
    CASE WHEN distinct_project_count = 1 THEN first_project_row.id ELSE NULL END,
    subtotal,
    vat_total,
    subtotal + vat_total,
    'Samlingsfaktura från ' || basis_count || ' projektunderlag',
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
    project_id,
    line_total_excl_vat,
    vat_amount,
    line_total_incl_vat,
    metadata
  )
  SELECT
    cp.organisation_id,
    target_company_id,
    invoice_row.id,
    row_number() OVER (ORDER BY b.created_at, b.id, pibl.created_at, pibl.id),
    COALESCE(NULLIF(b.basis_number, ''), 'Projektunderlag') || ': ' || pibl.description,
    pibl.quantity,
    pibl.unit,
    pibl.unit_price,
    pibl.vat_rate,
    CASE pibl.source_type
      WHEN 'time' THEN 'time'
      WHEN 'material' THEN 'material'
      WHEN 'change_order' THEN 'fee'
      ELSE 'manual'
    END,
    b.project_id,
    round((pibl.quantity * pibl.unit_price)::numeric, 2),
    round((pibl.quantity * pibl.unit_price * pibl.vat_rate / 100)::numeric, 2),
    round((pibl.quantity * pibl.unit_price * (1 + pibl.vat_rate / 100))::numeric, 2),
    jsonb_build_object(
      'project_invoice_basis_id', b.id,
      'project_invoice_basis_line_id', pibl.id,
      'source_type', pibl.source_type,
      'source_id', pibl.source_id
    )
  FROM public.vihem_project_invoice_basis b
  JOIN public.vihem_customer_projects cp ON cp.id = b.project_id
  JOIN public.vihem_project_invoice_basis_lines pibl ON pibl.basis_id = b.id
  WHERE b.id = ANY(target_basis_ids)
    AND pibl.billing_status = 'ready';

  PERFORM public.vihem_recalculate_invoice_totals(invoice_row.id);

  UPDATE public.vihem_project_invoice_basis
  SET
    status = 'invoiced',
    finance_invoice_id = invoice_row.id,
    updated_at = now()
  WHERE id = ANY(target_basis_ids);

  UPDATE public.vihem_project_invoice_basis_lines
  SET billing_status = 'invoiced'
  WHERE basis_id = ANY(target_basis_ids)
    AND billing_status = 'ready';

  RETURN invoice_row;
END;
$$;
