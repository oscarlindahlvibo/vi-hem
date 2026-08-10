/*
  # Finance invoice balance due compatibility

  Keeps customer invoice balance_due available and synchronized after the
  prepaid short-stay backfill introduced the column for existing installations.
*/

ALTER TABLE public.vihem_invoices
  ADD COLUMN IF NOT EXISTS balance_due numeric(14,2) NOT NULL DEFAULT 0;

UPDATE public.vihem_invoices
SET
  balance_due = GREATEST(COALESCE(total_amount, 0) - COALESCE(paid_amount, 0), 0),
  updated_at = now()
WHERE balance_due IS DISTINCT FROM GREATEST(COALESCE(total_amount, 0) - COALESCE(paid_amount, 0), 0);

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
    balance_due = GREATEST(COALESCE(lines.total, 0) - COALESCE(i.paid_amount, 0), 0),
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
      balance_due = 0,
      updated_at = now()
    WHERE id = target_invoice_id
    RETURNING * INTO updated_invoice;
  END IF;

  RETURN updated_invoice;
END;
$$;

CREATE OR REPLACE FUNCTION public.vihem_recalculate_invoice_payment_status(target_invoice_id uuid)
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

  SELECT COALESCE(SUM(amount), 0)
  INTO new_paid_amount
  FROM public.vihem_payments
  WHERE invoice_id = target_invoice_id;

  next_payment_status := CASE
    WHEN new_paid_amount = 0 THEN 'unpaid'
    WHEN ABS(new_paid_amount - invoice_row.total_amount) < 0.01 THEN 'paid'
    WHEN new_paid_amount < invoice_row.total_amount THEN 'partially_paid'
    ELSE 'overpaid'
  END;

  next_invoice_status := CASE
    WHEN invoice_row.status IN ('credited', 'cancelled') THEN invoice_row.status
    WHEN next_payment_status IN ('paid', 'overpaid') THEN 'paid'
    WHEN next_payment_status = 'partially_paid' THEN 'partially_paid'
    ELSE invoice_row.status
  END;

  UPDATE public.vihem_invoices
  SET
    paid_amount = new_paid_amount,
    balance_due = GREATEST(invoice_row.total_amount - new_paid_amount, 0),
    payment_status = next_payment_status,
    status = next_invoice_status,
    paid_at = CASE WHEN next_payment_status IN ('paid', 'overpaid') THEN COALESCE(paid_at, now()) ELSE paid_at END,
    updated_at = now()
  WHERE id = target_invoice_id
  RETURNING * INTO invoice_row;

  RETURN invoice_row;
END;
$$;

NOTIFY pgrst, 'reload schema';
