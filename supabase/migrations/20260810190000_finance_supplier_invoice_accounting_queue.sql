/*
  # Queue supplier invoices for accounting

  Adds a small wrapper around the generic accounting sync queue so the UI can
  queue supplier invoices only after approval.
*/

CREATE OR REPLACE FUNCTION public.vihem_queue_supplier_invoice_accounting_sync(target_supplier_invoice_id uuid)
RETURNS public.vihem_accounting_sync_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invoice_record public.vihem_supplier_invoices%ROWTYPE;
  queue_record public.vihem_accounting_sync_queue%ROWTYPE;
BEGIN
  SELECT * INTO invoice_record
  FROM public.vihem_supplier_invoices
  WHERE id = target_supplier_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leverantörsfakturan hittades inte.';
  END IF;

  IF invoice_record.approval_status <> 'approved' THEN
    RAISE EXCEPTION 'Endast attesterade leverantörsfakturor kan köas för bokföring.';
  END IF;

  queue_record := public.vihem_queue_accounting_sync(
    invoice_record.company_id,
    'supplier_invoice',
    invoice_record.id,
    'upsert'
  );

  UPDATE public.vihem_supplier_invoices
  SET accounting_status = 'pending'
  WHERE id = invoice_record.id
    AND accounting_status <> 'synced';

  RETURN queue_record;
END;
$$;

NOTIFY pgrst, 'reload schema';
