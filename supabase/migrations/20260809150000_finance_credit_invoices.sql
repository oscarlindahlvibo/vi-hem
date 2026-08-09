/*
  # VI-HEM finance credit invoices

  Adds explicit credit invoice relations and server-side creation of credit
  invoices. Credit invoices are separate draft invoices with negative rows and
  receive their own invoice number when approved.
*/

ALTER TABLE public.vihem_invoices
  ADD COLUMN IF NOT EXISTS original_invoice_id uuid REFERENCES public.vihem_invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS credited_by_invoice_id uuid REFERENCES public.vihem_invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS credit_reason text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS vihem_invoices_original_invoice_idx
  ON public.vihem_invoices (original_invoice_id);
CREATE INDEX IF NOT EXISTS vihem_invoices_credited_by_idx
  ON public.vihem_invoices (credited_by_invoice_id);

CREATE OR REPLACE FUNCTION public.vihem_create_credit_invoice(
  target_invoice_id uuid,
  credit_reason text DEFAULT ''
)
RETURNS public.vihem_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  original_invoice public.vihem_invoices%ROWTYPE;
  credit_invoice public.vihem_invoices%ROWTYPE;
BEGIN
  SELECT *
  INTO original_invoice
  FROM public.vihem_invoices
  WHERE id = target_invoice_id
  FOR UPDATE;

  IF original_invoice.id IS NULL THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF NOT public.vihem_user_has_company_access(original_invoice.company_id, 'approver') THEN
    RAISE EXCEPTION 'Not allowed to create credit invoice';
  END IF;

  IF original_invoice.original_invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot credit a credit invoice';
  END IF;

  IF original_invoice.status NOT IN ('approved', 'sent', 'partially_paid', 'paid', 'overdue') THEN
    RAISE EXCEPTION 'Only approved, sent or paid invoices can be credited';
  END IF;

  IF original_invoice.credited_by_invoice_id IS NOT NULL OR original_invoice.status = 'credited' THEN
    RAISE EXCEPTION 'Invoice has already been credited';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.vihem_invoices existing_credit
    WHERE existing_credit.original_invoice_id = original_invoice.id
      AND existing_credit.status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'A credit invoice already exists for this invoice';
  END IF;

  INSERT INTO public.vihem_invoices (
    organisation_id,
    company_id,
    customer_id,
    invoice_date,
    due_date,
    payment_terms_days,
    currency,
    status,
    accounting_status,
    payment_status,
    source_type,
    source_id,
    project_id,
    work_order_id,
    tenancy_id,
    subtotal_amount,
    vat_amount,
    total_amount,
    paid_amount,
    notes,
    original_invoice_id,
    credit_reason,
    created_by
  )
  VALUES (
    original_invoice.organisation_id,
    original_invoice.company_id,
    original_invoice.customer_id,
    CURRENT_DATE,
    CURRENT_DATE,
    0,
    original_invoice.currency,
    'draft',
    'not_synced',
    'unpaid',
    'credit_invoice',
    original_invoice.id,
    original_invoice.project_id,
    original_invoice.work_order_id,
    original_invoice.tenancy_id,
    0,
    0,
    0,
    0,
    trim(COALESCE(NULLIF(credit_reason, ''), 'Kreditering av faktura ' || COALESCE(original_invoice.invoice_number, original_invoice.id::text))),
    original_invoice.id,
    trim(COALESCE(credit_reason, '')),
    auth.uid()
  )
  RETURNING * INTO credit_invoice;

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
    account_code,
    line_type,
    project_id,
    work_order_id,
    tenancy_id,
    time_entry_id,
    line_total_excl_vat,
    vat_amount,
    line_total_incl_vat,
    metadata
  )
  SELECT
    organisation_id,
    company_id,
    credit_invoice.id,
    line_no,
    'Kreditering: ' || description,
    quantity,
    unit,
    -unit_price,
    vat_rate,
    account_code,
    line_type,
    project_id,
    work_order_id,
    tenancy_id,
    time_entry_id,
    -line_total_excl_vat,
    -vat_amount,
    -line_total_incl_vat,
    metadata || jsonb_build_object('credited_invoice_line_id', id)
  FROM public.vihem_invoice_lines
  WHERE invoice_id = original_invoice.id
  ORDER BY line_no;

  SELECT *
  INTO credit_invoice
  FROM public.vihem_recalculate_invoice_totals(credit_invoice.id);

  RETURN credit_invoice;
END;
$$;

CREATE OR REPLACE FUNCTION public.vihem_approve_invoice(target_invoice_id uuid, target_series_id uuid DEFAULT NULL)
RETURNS public.vihem_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invoice_row public.vihem_invoices%ROWTYPE;
  series_id uuid;
  next_number text;
BEGIN
  SELECT *
  INTO invoice_row
  FROM public.vihem_invoices
  WHERE id = target_invoice_id
  FOR UPDATE;

  IF invoice_row.id IS NULL THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF NOT public.vihem_user_has_company_access(invoice_row.company_id, 'approver') THEN
    RAISE EXCEPTION 'Not allowed to approve invoice';
  END IF;

  IF invoice_row.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft invoices can be approved';
  END IF;

  IF invoice_row.original_invoice_id IS NULL AND invoice_row.total_amount <= 0 THEN
    RAISE EXCEPTION 'Invoice total must be greater than zero';
  END IF;

  IF invoice_row.original_invoice_id IS NOT NULL AND invoice_row.total_amount >= 0 THEN
    RAISE EXCEPTION 'Credit invoice total must be less than zero';
  END IF;

  IF target_series_id IS NOT NULL THEN
    SELECT id
    INTO series_id
    FROM public.vihem_invoice_number_series
    WHERE id = target_series_id
      AND company_id = invoice_row.company_id
      AND active = true;
  ELSE
    SELECT id
    INTO series_id
    FROM public.vihem_invoice_number_series
    WHERE company_id = invoice_row.company_id
      AND active = true
    ORDER BY fiscal_year NULLS LAST, created_at
    LIMIT 1;
  END IF;

  IF series_id IS NULL THEN
    RAISE EXCEPTION 'No active invoice number series found';
  END IF;

  next_number := public.vihem_next_invoice_number(series_id);

  UPDATE public.vihem_invoices
  SET
    invoice_number = next_number,
    status = 'approved',
    approved_by = auth.uid(),
    approved_at = now(),
    locked_at = now(),
    updated_at = now()
  WHERE id = target_invoice_id
  RETURNING * INTO invoice_row;

  IF invoice_row.original_invoice_id IS NOT NULL THEN
    UPDATE public.vihem_invoices
    SET
      status = 'credited',
      credited_by_invoice_id = invoice_row.id,
      updated_at = now()
    WHERE id = invoice_row.original_invoice_id
      AND status <> 'cancelled';
  END IF;

  RETURN invoice_row;
END;
$$;
