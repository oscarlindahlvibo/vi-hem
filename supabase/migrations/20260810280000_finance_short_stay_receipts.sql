/*
  # Short stay receipts and finance invoice conversion

  Lets admins create traceable finance invoices/receipts from short stay bookings
  without creating duplicates.
*/

ALTER TABLE public.vihem_short_stay_bookings
  ADD COLUMN IF NOT EXISTS finance_invoice_id uuid REFERENCES public.vihem_invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS vihem_short_stay_bookings_finance_invoice_idx
  ON public.vihem_short_stay_bookings (finance_invoice_id)
  WHERE finance_invoice_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.vihem_find_or_create_short_stay_customer(
  target_company_id uuid,
  guest_name text,
  guest_email text,
  guest_phone text
)
RETURNS public.vihem_finance_customers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  company_row public.vihem_companies%ROWTYPE;
  customer_row public.vihem_finance_customers%ROWTYPE;
  clean_name text := NULLIF(trim(COALESCE(guest_name, '')), '');
  clean_email text := NULLIF(lower(trim(COALESCE(guest_email, ''))), '');
BEGIN
  SELECT * INTO company_row
  FROM public.vihem_companies
  WHERE id = target_company_id;

  IF company_row.id IS NULL THEN
    RAISE EXCEPTION 'Bolaget hittades inte.';
  END IF;

  SELECT *
  INTO customer_row
  FROM public.vihem_finance_customers
  WHERE organisation_id = company_row.organisation_id
    AND (company_id IS NULL OR company_id = target_company_id)
    AND (
      (clean_email IS NOT NULL AND lower(COALESCE(invoice_email, email)) = clean_email)
      OR (clean_name IS NOT NULL AND lower(name) = lower(clean_name))
    )
  ORDER BY company_id NULLS LAST, updated_at DESC
  LIMIT 1;

  IF customer_row.id IS NOT NULL THEN
    RETURN customer_row;
  END IF;

  INSERT INTO public.vihem_finance_customers (
    organisation_id,
    company_id,
    customer_type,
    name,
    email,
    invoice_email,
    phone,
    payment_terms_days,
    notes,
    created_by
  )
  VALUES (
    company_row.organisation_id,
    target_company_id,
    'private',
    COALESCE(clean_name, 'Korttidsgäst'),
    COALESCE(clean_email, ''),
    COALESCE(clean_email, ''),
    trim(COALESCE(guest_phone, '')),
    0,
    'Skapad automatiskt från korttidsbokning.',
    auth.uid()
  )
  RETURNING * INTO customer_row;

  RETURN customer_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.vihem_create_invoice_from_short_stay_booking(
  target_booking_id uuid,
  target_company_id uuid DEFAULT NULL,
  target_customer_id uuid DEFAULT NULL,
  approve_invoice boolean DEFAULT false
)
RETURNS public.vihem_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  booking_row public.vihem_short_stay_bookings%ROWTYPE;
  unit_row public.vihem_short_stay_units%ROWTYPE;
  company_row public.vihem_companies%ROWTYPE;
  customer_row public.vihem_finance_customers%ROWTYPE;
  invoice_row public.vihem_invoices%ROWTYPE;
  subtotal numeric(14,2);
  vat_rate numeric(6,2);
  vat_amount numeric(14,2);
  total numeric(14,2);
  effective_paid_amount numeric(14,2);
  effective_payment_status text;
  normalized_channel text;
  line_description text;
BEGIN
  SELECT *
  INTO booking_row
  FROM public.vihem_short_stay_bookings
  WHERE id = target_booking_id
  FOR UPDATE;

  IF booking_row.id IS NULL THEN
    RAISE EXCEPTION 'Bokningen hittades inte.';
  END IF;

  IF booking_row.booking_type <> 'booking' THEN
    RAISE EXCEPTION 'Endast riktiga bokningar kan faktureras eller få kvitto.';
  END IF;

  IF booking_row.finance_invoice_id IS NOT NULL THEN
    SELECT * INTO invoice_row
    FROM public.vihem_invoices
    WHERE id = booking_row.finance_invoice_id;
    IF invoice_row.id IS NOT NULL THEN
      RETURN invoice_row;
    END IF;
  END IF;

  IF NOT public.is_short_stay_enabled(booking_row.organisation_id) THEN
    RAISE EXCEPTION 'Korttidsuthyrning är inte aktiverad för organisationen.';
  END IF;

  IF NOT (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND public.get_my_org_id() = booking_row.organisation_id)
  ) THEN
    RAISE EXCEPTION 'Saknar behörighet att skapa kvitto från korttidsbokning.';
  END IF;

  SELECT * INTO unit_row
  FROM public.vihem_short_stay_units
  WHERE id = booking_row.unit_id;

  IF target_company_id IS NULL THEN
    SELECT * INTO company_row
    FROM public.vihem_companies
    WHERE organisation_id = booking_row.organisation_id
      AND active = true
    ORDER BY created_at
    LIMIT 1;
  ELSE
    SELECT * INTO company_row
    FROM public.vihem_companies
    WHERE id = target_company_id
      AND organisation_id = booking_row.organisation_id;
  END IF;

  IF company_row.id IS NULL THEN
    RAISE EXCEPTION 'Lägg upp ett bolag i ekonomimodulen innan kvitto skapas.';
  END IF;

  IF NOT public.vihem_user_has_company_access(company_row.id, 'seller') THEN
    RAISE EXCEPTION 'Saknar bolagsbehörighet för att skapa korttidskvitto.';
  END IF;

  IF target_customer_id IS NULL THEN
    customer_row := public.vihem_find_or_create_short_stay_customer(
      company_row.id,
      booking_row.guest_name,
      booking_row.guest_email,
      booking_row.guest_phone
    );
  ELSE
    SELECT * INTO customer_row
    FROM public.vihem_finance_customers
    WHERE id = target_customer_id
      AND organisation_id = booking_row.organisation_id
      AND (company_id IS NULL OR company_id = company_row.id);
  END IF;

  IF customer_row.id IS NULL THEN
    RAISE EXCEPTION 'Kunden hittades inte.';
  END IF;

  total := COALESCE(NULLIF(booking_row.total_price, 0), booking_row.paid_amount, 0);
  IF total <= 0 THEN
    RAISE EXCEPTION 'Bokningen saknar pris.';
  END IF;

  normalized_channel := lower(regexp_replace(COALESCE(booking_row.channel_name, ''), '[\s._-]+', '', 'g'));
  IF normalized_channel LIKE '%airbnb%'
    OR normalized_channel LIKE '%booking%'
    OR normalized_channel LIKE '%expedia%'
    OR normalized_channel LIKE '%hotelscom%'
    OR normalized_channel LIKE '%vrbo%'
    OR normalized_channel LIKE '%homeaway%'
  THEN
    effective_payment_status := 'paid';
    effective_paid_amount := total;
  ELSE
    effective_payment_status := booking_row.payment_status;
    effective_paid_amount := COALESCE(booking_row.paid_amount, 0);
  END IF;

  vat_rate := COALESCE(company_row.default_vat_rate, 12);
  subtotal := round(total / (1 + (vat_rate / 100)), 2);
  vat_amount := total - subtotal;
  line_description := concat_ws(
    ' · ',
    COALESCE(NULLIF(unit_row.name, ''), 'Korttidsboende'),
    booking_row.start_date::text || ' - ' || booking_row.end_date::text,
    COALESCE(NULLIF(booking_row.channel_name, ''), 'VI-HEM')
  );

  INSERT INTO public.vihem_invoices (
    organisation_id,
    company_id,
    customer_id,
    invoice_date,
    due_date,
    payment_terms_days,
    currency,
    status,
    payment_status,
    source_type,
    source_id,
    subtotal_amount,
    vat_amount,
    total_amount,
    paid_amount,
    notes,
    created_by
  )
  VALUES (
    booking_row.organisation_id,
    company_row.id,
    customer_row.id,
    CURRENT_DATE,
    CURRENT_DATE,
    0,
    COALESCE(NULLIF(booking_row.currency, ''), company_row.default_currency, 'SEK'),
    'draft',
    CASE WHEN effective_payment_status = 'paid' THEN 'paid' WHEN effective_payment_status = 'partial' THEN 'partially_paid' ELSE 'unpaid' END,
    'short_stay',
    booking_row.id,
    subtotal,
    vat_amount,
    total,
    effective_paid_amount,
    'Skapad från korttidsbokning.',
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
    line_total_excl_vat,
    vat_amount,
    line_total_incl_vat,
    metadata
  )
  VALUES (
    booking_row.organisation_id,
    company_row.id,
    invoice_row.id,
    1,
    line_description,
    1,
    'st',
    subtotal,
    vat_rate,
    'short_stay',
    subtotal,
    vat_amount,
    total,
    jsonb_build_object(
      'short_stay_booking_id', booking_row.id,
      'channel_name', booking_row.channel_name,
      'beds24_booking_id', booking_row.beds24_booking_id
    )
  );

  IF approve_invoice THEN
    invoice_row := public.vihem_approve_invoice(invoice_row.id, NULL);
  END IF;

  IF effective_payment_status IN ('paid', 'partial') AND effective_paid_amount > 0 THEN
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
      booking_row.organisation_id,
      company_row.id,
      invoice_row.id,
      CURRENT_DATE,
      LEAST(effective_paid_amount, total),
      COALESCE(NULLIF(booking_row.currency, ''), company_row.default_currency, 'SEK'),
      'accounting',
      COALESCE(NULLIF(booking_row.channel_name, ''), 'Korttidsbetalning'),
      COALESCE(NULLIF(booking_row.beds24_booking_id, ''), NULLIF(booking_row.external_uid, ''), booking_row.id::text),
      auth.uid()
    )
    ON CONFLICT (company_id, external_payment_id) WHERE external_payment_id <> ''
    DO NOTHING;

    PERFORM public.vihem_recalculate_invoice_payment_status(invoice_row.id);
    SELECT * INTO invoice_row FROM public.vihem_invoices WHERE id = invoice_row.id;
  END IF;

  UPDATE public.vihem_short_stay_bookings
  SET
    finance_invoice_id = invoice_row.id,
    updated_at = now()
  WHERE id = booking_row.id;

  RETURN invoice_row;
END;
$$;

NOTIFY pgrst, 'reload schema';
