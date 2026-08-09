/*
  # VI-HEM finance phase 2

  Adds server-side invoice approval, invoice total recalculation, payment
  registration and invoice document references.
*/

ALTER TABLE public.vihem_invoices
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES public.vihem_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelled_reason text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS vihem_invoices_document_idx ON public.vihem_invoices (document_id);

CREATE OR REPLACE FUNCTION public.vihem_recalculate_invoice_totals(target_invoice_id uuid)
RETURNS public.vihem_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_invoice public.vihem_invoices%ROWTYPE;
BEGIN
  UPDATE public.vihem_invoices i
  SET
    subtotal_amount = COALESCE(lines.subtotal, 0),
    vat_amount = COALESCE(lines.vat, 0),
    total_amount = COALESCE(lines.total, 0),
    updated_at = now()
  FROM (
    SELECT
      invoice_id,
      SUM(line_total_excl_vat) AS subtotal,
      SUM(vat_amount) AS vat,
      SUM(line_total_incl_vat) AS total
    FROM public.vihem_invoice_lines
    WHERE invoice_id = target_invoice_id
    GROUP BY invoice_id
  ) lines
  WHERE i.id = target_invoice_id
    AND i.id = lines.invoice_id
  RETURNING i.* INTO updated_invoice;

  IF updated_invoice.id IS NULL THEN
    UPDATE public.vihem_invoices
    SET
      subtotal_amount = 0,
      vat_amount = 0,
      total_amount = 0,
      updated_at = now()
    WHERE id = target_invoice_id
    RETURNING * INTO updated_invoice;
  END IF;

  RETURN updated_invoice;
END;
$$;

CREATE OR REPLACE FUNCTION public.vihem_invoice_lines_recalculate_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.vihem_recalculate_invoice_totals(COALESCE(NEW.invoice_id, OLD.invoice_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS vihem_invoice_lines_recalculate_trigger ON public.vihem_invoice_lines;
CREATE TRIGGER vihem_invoice_lines_recalculate_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.vihem_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public.vihem_invoice_lines_recalculate_trigger();

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

  IF invoice_row.total_amount <= 0 THEN
    RAISE EXCEPTION 'Invoice total must be greater than zero';
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

  RETURN invoice_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.vihem_mark_invoice_sent(target_invoice_id uuid)
RETURNS public.vihem_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invoice_row public.vihem_invoices%ROWTYPE;
BEGIN
  SELECT *
  INTO invoice_row
  FROM public.vihem_invoices
  WHERE id = target_invoice_id
  FOR UPDATE;

  IF invoice_row.id IS NULL THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF NOT public.vihem_user_has_company_access(invoice_row.company_id, 'seller') THEN
    RAISE EXCEPTION 'Not allowed to update invoice';
  END IF;

  IF invoice_row.status NOT IN ('approved', 'sent') THEN
    RAISE EXCEPTION 'Invoice must be approved before it can be sent';
  END IF;

  UPDATE public.vihem_invoices
  SET
    status = 'sent',
    sent_at = COALESCE(sent_at, now()),
    updated_at = now()
  WHERE id = target_invoice_id
  RETURNING * INTO invoice_row;

  RETURN invoice_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.vihem_register_invoice_payment(
  target_invoice_id uuid,
  payment_amount numeric,
  payment_date date DEFAULT CURRENT_DATE,
  payment_reference text DEFAULT ''
)
RETURNS public.vihem_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invoice_row public.vihem_invoices%ROWTYPE;
  new_paid_amount numeric(14,2);
  next_payment_status text;
  next_invoice_status text;
BEGIN
  SELECT *
  INTO invoice_row
  FROM public.vihem_invoices
  WHERE id = target_invoice_id
  FOR UPDATE;

  IF invoice_row.id IS NULL THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF NOT public.vihem_user_has_company_access(invoice_row.company_id, 'bookkeeper') THEN
    RAISE EXCEPTION 'Not allowed to register payment';
  END IF;

  IF payment_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  INSERT INTO public.vihem_payments (
    organisation_id,
    company_id,
    invoice_id,
    payment_date,
    amount,
    currency,
    source,
    reference,
    created_by
  )
  VALUES (
    invoice_row.organisation_id,
    invoice_row.company_id,
    invoice_row.id,
    payment_date,
    payment_amount,
    invoice_row.currency,
    'manual',
    payment_reference,
    auth.uid()
  );

  SELECT COALESCE(SUM(amount), 0)
  INTO new_paid_amount
  FROM public.vihem_payments
  WHERE invoice_id = target_invoice_id;

  next_payment_status := CASE
    WHEN new_paid_amount = 0 THEN 'unpaid'
    WHEN new_paid_amount < invoice_row.total_amount THEN 'partially_paid'
    WHEN new_paid_amount = invoice_row.total_amount THEN 'paid'
    ELSE 'overpaid'
  END;

  next_invoice_status := CASE
    WHEN next_payment_status IN ('paid', 'overpaid') THEN 'paid'
    WHEN next_payment_status = 'partially_paid' THEN 'partially_paid'
    ELSE invoice_row.status
  END;

  UPDATE public.vihem_invoices
  SET
    paid_amount = new_paid_amount,
    payment_status = next_payment_status,
    status = next_invoice_status,
    paid_at = CASE WHEN next_payment_status IN ('paid', 'overpaid') THEN now() ELSE paid_at END,
    updated_at = now()
  WHERE id = target_invoice_id
  RETURNING * INTO invoice_row;

  RETURN invoice_row;
END;
$$;
