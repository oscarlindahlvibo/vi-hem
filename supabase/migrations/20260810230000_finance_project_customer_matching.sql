CREATE OR REPLACE FUNCTION public.vihem_ensure_finance_customer_for_project(
  target_organisation_id uuid,
  target_company_id uuid,
  target_project_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  project_row public.vihem_customer_projects%ROWTYPE;
  project_customer_row public.vihem_project_customers%ROWTYPE;
  matched_customer_id uuid;
  customer_name text;
  customer_email text;
  customer_phone text;
  customer_type text;
BEGIN
  IF NOT public.vihem_user_has_company_access(target_company_id, 'seller') THEN
    RAISE EXCEPTION 'Not allowed to create invoice';
  END IF;

  SELECT *
  INTO project_row
  FROM public.vihem_customer_projects
  WHERE id = target_project_id
    AND organisation_id = target_organisation_id;

  IF project_row.id IS NULL THEN
    RAISE EXCEPTION 'Project not found';
  END IF;

  IF project_row.customer_id IS NOT NULL THEN
    SELECT *
    INTO project_customer_row
    FROM public.vihem_project_customers
    WHERE id = project_row.customer_id
      AND organisation_id = target_organisation_id;
  END IF;

  customer_name := COALESCE(
    NULLIF(trim(project_customer_row.name), ''),
    NULLIF(trim(project_row.customer_name), ''),
    NULLIF(trim(project_row.title), ''),
    NULLIF(trim(project_row.name), ''),
    'Kundprojekt ' || left(project_row.id::text, 8)
  );
  customer_email := COALESCE(NULLIF(trim(project_customer_row.email), ''), '');
  customer_phone := COALESCE(NULLIF(trim(project_customer_row.phone), ''), '');
  customer_type := CASE
    WHEN project_customer_row.customer_type IN ('private', 'company', 'brf', 'property_owner', 'internal') THEN project_customer_row.customer_type
    ELSE 'company'
  END;

  SELECT fc.id
  INTO matched_customer_id
  FROM public.vihem_finance_customers fc
  WHERE fc.organisation_id = target_organisation_id
    AND (fc.company_id = target_company_id OR fc.company_id IS NULL)
    AND (
      (customer_email <> '' AND lower(COALESCE(NULLIF(fc.invoice_email, ''), fc.email)) = lower(customer_email))
      OR lower(trim(fc.name)) = lower(customer_name)
    )
  ORDER BY
    CASE WHEN fc.company_id = target_company_id THEN 0 ELSE 1 END,
    fc.created_at
  LIMIT 1;

  IF matched_customer_id IS NOT NULL THEN
    RETURN matched_customer_id;
  END IF;

  INSERT INTO public.vihem_finance_customers (
    organisation_id,
    company_id,
    customer_type,
    name,
    organisation_number,
    email,
    invoice_email,
    phone,
    address_line1,
    payment_terms_days,
    notes,
    created_by
  )
  VALUES (
    target_organisation_id,
    target_company_id,
    customer_type,
    customer_name,
    COALESCE(project_customer_row.identity_number, ''),
    customer_email,
    customer_email,
    customer_phone,
    COALESCE(project_customer_row.invoice_address, ''),
    30,
    'Skapad automatiskt från kundprojekt ' || COALESCE(NULLIF(project_row.title, ''), project_row.name, project_row.id::text),
    auth.uid()
  )
  RETURNING id INTO matched_customer_id;

  RETURN matched_customer_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.vihem_create_invoice_from_project_basis(
  target_basis_id uuid,
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
  basis_row public.vihem_project_invoice_basis%ROWTYPE;
  project_row public.vihem_customer_projects%ROWTYPE;
  customer_row public.vihem_finance_customers%ROWTYPE;
  invoice_row public.vihem_invoices%ROWTYPE;
  calculated_due date;
  resolved_customer_id uuid;
BEGIN
  SELECT *
  INTO basis_row
  FROM public.vihem_project_invoice_basis
  WHERE id = target_basis_id
  FOR UPDATE;

  IF basis_row.id IS NULL THEN
    RAISE EXCEPTION 'Project invoice basis not found';
  END IF;

  IF basis_row.status = 'invoiced' OR basis_row.finance_invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'Project invoice basis has already been invoiced';
  END IF;

  SELECT *
  INTO project_row
  FROM public.vihem_customer_projects
  WHERE id = basis_row.project_id;

  IF project_row.id IS NULL THEN
    RAISE EXCEPTION 'Project not found';
  END IF;

  IF NOT public.vihem_user_has_company_access(target_company_id, 'seller') THEN
    RAISE EXCEPTION 'Not allowed to create invoice';
  END IF;

  resolved_customer_id := COALESCE(
    target_customer_id,
    public.vihem_ensure_finance_customer_for_project(project_row.organisation_id, target_company_id, project_row.id)
  );

  SELECT *
  INTO customer_row
  FROM public.vihem_finance_customers
  WHERE id = resolved_customer_id
    AND organisation_id = project_row.organisation_id;

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
    project_row.organisation_id,
    target_company_id,
    resolved_customer_id,
    invoice_date,
    calculated_due,
    customer_row.payment_terms_days,
    'draft',
    'project_invoice_basis',
    basis_row.id,
    project_row.id,
    basis_row.total_amount,
    basis_row.vat_amount,
    basis_row.total_amount + basis_row.vat_amount,
    basis_row.description,
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
    project_row.organisation_id,
    target_company_id,
    invoice_row.id,
    row_number() OVER (ORDER BY pibl.created_at, pibl.id),
    pibl.description,
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
    project_row.id,
    round((pibl.quantity * pibl.unit_price)::numeric, 2),
    round((pibl.quantity * pibl.unit_price * pibl.vat_rate / 100)::numeric, 2),
    round((pibl.quantity * pibl.unit_price * (1 + pibl.vat_rate / 100))::numeric, 2),
    jsonb_build_object('project_invoice_basis_line_id', pibl.id, 'source_type', pibl.source_type, 'source_id', pibl.source_id)
  FROM public.vihem_project_invoice_basis_lines pibl
  WHERE pibl.basis_id = basis_row.id
    AND pibl.billing_status = 'ready';

  PERFORM public.vihem_recalculate_invoice_totals(invoice_row.id);

  UPDATE public.vihem_project_invoice_basis
  SET
    status = 'invoiced',
    finance_invoice_id = invoice_row.id,
    updated_at = now()
  WHERE id = basis_row.id;

  UPDATE public.vihem_project_invoice_basis_lines
  SET billing_status = 'invoiced'
  WHERE basis_id = basis_row.id
    AND billing_status = 'ready';

  RETURN invoice_row;
END;
$$;
