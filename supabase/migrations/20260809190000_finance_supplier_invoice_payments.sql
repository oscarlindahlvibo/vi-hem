-- Supplier invoice payment workflow.

CREATE OR REPLACE FUNCTION public.vihem_schedule_supplier_invoice_payment(target_supplier_invoice_id uuid)
RETURNS public.vihem_supplier_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invoice_row public.vihem_supplier_invoices%ROWTYPE;
BEGIN
  SELECT *
  INTO invoice_row
  FROM public.vihem_supplier_invoices
  WHERE id = target_supplier_invoice_id
  FOR UPDATE;

  IF invoice_row.id IS NULL THEN
    RAISE EXCEPTION 'Leverantörsfakturan hittades inte.';
  END IF;

  IF NOT public.vihem_user_has_company_access(invoice_row.company_id, 'bookkeeper') THEN
    RAISE EXCEPTION 'Saknar behörighet att schemalägga betalning.';
  END IF;

  IF invoice_row.approval_status <> 'approved' THEN
    RAISE EXCEPTION 'Leverantörsfakturan måste vara attesterad först.';
  END IF;

  UPDATE public.vihem_supplier_invoices
  SET
    status = 'scheduled_for_payment',
    payment_status = 'scheduled',
    updated_at = now()
  WHERE id = target_supplier_invoice_id
  RETURNING * INTO invoice_row;

  PERFORM public.vihem_queue_accounting_sync(
    invoice_row.company_id,
    'supplier_invoice',
    invoice_row.id,
    'upsert'
  );

  RETURN invoice_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.vihem_mark_supplier_invoice_paid(
  target_supplier_invoice_id uuid,
  paid_date date DEFAULT CURRENT_DATE
)
RETURNS public.vihem_supplier_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invoice_row public.vihem_supplier_invoices%ROWTYPE;
BEGIN
  SELECT *
  INTO invoice_row
  FROM public.vihem_supplier_invoices
  WHERE id = target_supplier_invoice_id
  FOR UPDATE;

  IF invoice_row.id IS NULL THEN
    RAISE EXCEPTION 'Leverantörsfakturan hittades inte.';
  END IF;

  IF NOT public.vihem_user_has_company_access(invoice_row.company_id, 'bookkeeper') THEN
    RAISE EXCEPTION 'Saknar behörighet att markera betalning.';
  END IF;

  IF invoice_row.approval_status <> 'approved' THEN
    RAISE EXCEPTION 'Leverantörsfakturan måste vara attesterad först.';
  END IF;

  UPDATE public.vihem_supplier_invoices
  SET
    status = 'paid',
    payment_status = 'paid',
    paid_amount = total_amount,
    ocr_data = COALESCE(ocr_data, '{}'::jsonb) || jsonb_build_object('paid_date', paid_date),
    updated_at = now()
  WHERE id = target_supplier_invoice_id
  RETURNING * INTO invoice_row;

  PERFORM public.vihem_queue_accounting_sync(
    invoice_row.company_id,
    'supplier_invoice',
    invoice_row.id,
    'payment'
  );

  RETURN invoice_row;
END;
$$;
