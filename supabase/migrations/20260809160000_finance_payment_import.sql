/*
  # VI-HEM finance payment import

  Adds idempotent payment import from CSV/bank exports. Rows are matched by
  company and invoice number, and external payment ids prevent duplicate imports.
*/

CREATE UNIQUE INDEX IF NOT EXISTS vihem_payments_company_external_unique
  ON public.vihem_payments (company_id, external_payment_id)
  WHERE external_payment_id <> '';

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
    payment_status = next_payment_status,
    status = next_invoice_status,
    paid_at = CASE WHEN next_payment_status IN ('paid', 'overpaid') THEN COALESCE(paid_at, now()) ELSE paid_at END,
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

  RETURN public.vihem_recalculate_invoice_payment_status(target_invoice_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.vihem_import_invoice_payments(
  target_company_id uuid,
  payment_rows jsonb,
  payment_source text DEFAULT 'bank'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item jsonb;
  invoice_row public.vihem_invoices%ROWTYPE;
  imported_count integer := 0;
  skipped_count integer := 0;
  failed_count integer := 0;
  row_amount numeric(14,2);
  row_date date;
  row_reference text;
  row_invoice_number text;
  row_external_id text;
  errors jsonb := '[]'::jsonb;
BEGIN
  IF payment_source NOT IN ('accounting', 'bank', 'swish', 'autogiro') THEN
    RAISE EXCEPTION 'Unsupported payment source';
  END IF;

  IF NOT public.vihem_user_has_company_access(target_company_id, 'bookkeeper') THEN
    RAISE EXCEPTION 'Not allowed to import payments';
  END IF;

  IF jsonb_typeof(payment_rows) <> 'array' THEN
    RAISE EXCEPTION 'payment_rows must be an array';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(payment_rows)
  LOOP
    BEGIN
      row_invoice_number := trim(COALESCE(item->>'invoice_number', item->>'fakturanummer', item->>'faktura', ''));
      row_amount := replace(trim(COALESCE(item->>'amount', item->>'belopp', '0')), ',', '.')::numeric;
      row_date := COALESCE(NULLIF(item->>'payment_date', ''), NULLIF(item->>'betaldatum', ''), CURRENT_DATE::text)::date;
      row_reference := trim(COALESCE(item->>'reference', item->>'referens', ''));
      row_external_id := trim(COALESCE(item->>'external_payment_id', item->>'transaktionsid', ''));

      IF row_invoice_number = '' THEN
        RAISE EXCEPTION 'Invoice number is missing';
      END IF;

      IF row_amount <= 0 THEN
        RAISE EXCEPTION 'Payment amount must be greater than zero';
      END IF;

      IF row_external_id = '' THEN
        row_external_id := md5(target_company_id::text || '|' || row_invoice_number || '|' || row_date::text || '|' || row_amount::text || '|' || row_reference);
      END IF;

      IF EXISTS (
        SELECT 1
        FROM public.vihem_payments
        WHERE company_id = target_company_id
          AND external_payment_id = row_external_id
      ) THEN
        skipped_count := skipped_count + 1;
        CONTINUE;
      END IF;

      SELECT *
      INTO invoice_row
      FROM public.vihem_invoices
      WHERE company_id = target_company_id
        AND invoice_number = row_invoice_number
      FOR UPDATE;

      IF invoice_row.id IS NULL THEN
        RAISE EXCEPTION 'Invoice % not found', row_invoice_number;
      END IF;

      IF invoice_row.status IN ('cancelled', 'credited') THEN
        RAISE EXCEPTION 'Invoice % is not payable', row_invoice_number;
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
        external_payment_id,
        created_by
      )
      VALUES (
        invoice_row.organisation_id,
        invoice_row.company_id,
        invoice_row.id,
        row_date,
        row_amount,
        invoice_row.currency,
        payment_source,
        row_reference,
        row_external_id,
        auth.uid()
      );

      PERFORM public.vihem_recalculate_invoice_payment_status(invoice_row.id);
      imported_count := imported_count + 1;
    EXCEPTION WHEN OTHERS THEN
      failed_count := failed_count + 1;
      errors := errors || jsonb_build_array(jsonb_build_object(
        'invoice_number', COALESCE(row_invoice_number, ''),
        'message', SQLERRM
      ));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'imported', imported_count,
    'skipped', skipped_count,
    'failed', failed_count,
    'errors', errors
  );
END;
$$;
