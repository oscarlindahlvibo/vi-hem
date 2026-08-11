-- Använd kvittots egna rader/moms och bokför faktisk OTA-avräkning.

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
  line_row jsonb;
  line_index integer := 0;
  line_gross numeric(14,2);
  line_net numeric(14,2);
  line_vat numeric(14,2);
  subtotal numeric(14,2) := 0;
  vat_rate numeric(6,2);
  vat_amount numeric(14,2) := 0;
  total numeric(14,2) := 0;
  commission numeric(14,2) := 0;
  effective_paid_amount numeric(14,2);
  effective_payment_status text;
  normalized_channel text;
  line_description text;
  lines jsonb;
BEGIN
  SELECT * INTO booking_row
  FROM public.vihem_short_stay_bookings
  WHERE id = target_booking_id
  FOR UPDATE;

  IF booking_row.id IS NULL THEN RAISE EXCEPTION 'Bokningen hittades inte.'; END IF;
  IF booking_row.booking_type <> 'booking' THEN RAISE EXCEPTION 'Endast riktiga bokningar kan få kvitto.'; END IF;
  IF booking_row.finance_invoice_id IS NOT NULL THEN
    SELECT * INTO invoice_row FROM public.vihem_invoices WHERE id = booking_row.finance_invoice_id;
    IF invoice_row.id IS NOT NULL THEN RETURN invoice_row; END IF;
  END IF;
  IF NOT public.is_short_stay_enabled(booking_row.organisation_id) THEN RAISE EXCEPTION 'Korttidsuthyrning är inte aktiverad för organisationen.'; END IF;
  IF NOT (public.get_my_role() = 'superadmin' OR (public.get_my_role() = 'admin' AND public.get_my_org_id() = booking_row.organisation_id)) THEN
    RAISE EXCEPTION 'Saknar behörighet att skapa kvitto från korttidsbokning.';
  END IF;

  SELECT * INTO unit_row FROM public.vihem_short_stay_units WHERE id = booking_row.unit_id;
  IF target_company_id IS NULL THEN target_company_id := booking_row.receipt_company_id; END IF;
  IF target_company_id IS NULL THEN
    SELECT * INTO company_row FROM public.vihem_companies
    WHERE organisation_id = booking_row.organisation_id AND active ORDER BY created_at LIMIT 1;
  ELSE
    SELECT * INTO company_row FROM public.vihem_companies
    WHERE id = target_company_id AND organisation_id = booking_row.organisation_id;
  END IF;
  IF company_row.id IS NULL THEN RAISE EXCEPTION 'Lägg upp eller välj ett bolag i ekonomimodulen innan kvitto skapas.'; END IF;
  IF NOT public.vihem_user_has_company_access(company_row.id, 'seller') THEN RAISE EXCEPTION 'Saknar bolagsbehörighet för att skapa korttidskvitto.'; END IF;

  IF target_customer_id IS NULL THEN
    customer_row := public.vihem_find_or_create_short_stay_customer(company_row.id, booking_row.guest_name, booking_row.guest_email, booking_row.guest_phone);
  ELSE
    SELECT * INTO customer_row FROM public.vihem_finance_customers
    WHERE id = target_customer_id AND organisation_id = booking_row.organisation_id AND (company_id IS NULL OR company_id = company_row.id);
  END IF;
  IF customer_row.id IS NULL THEN RAISE EXCEPTION 'Kunden hittades inte.'; END IF;

  vat_rate := CASE WHEN booking_row.receipt_vat_exempt THEN 0 ELSE GREATEST(COALESCE(booking_row.receipt_vat_rate, 12), 0) END;
  lines := CASE
    WHEN jsonb_typeof(booking_row.receipt_lines) = 'array' AND jsonb_array_length(booking_row.receipt_lines) > 0 THEN booking_row.receipt_lines
    ELSE jsonb_build_array(jsonb_build_object('description', COALESCE(NULLIF(unit_row.name, ''), 'Korttidsboende'), 'amount', COALESCE(booking_row.total_price, 0)))
  END;

  line_index := 0;
  FOR line_row IN SELECT value FROM jsonb_array_elements(lines)
  LOOP
    line_index := line_index + 1;
    line_gross := round(GREATEST(COALESCE((line_row->>'amount')::numeric, 0), 0), 2);
    line_net := CASE WHEN vat_rate = 0 THEN line_gross ELSE round(line_gross / (1 + vat_rate / 100), 2) END;
    line_vat := line_gross - line_net;
    subtotal := subtotal + line_net;
    vat_amount := vat_amount + line_vat;
    total := total + line_gross;
  END LOOP;
  IF total <= 0 THEN RAISE EXCEPTION 'Kvitto saknar belopp.'; END IF;

  normalized_channel := lower(regexp_replace(COALESCE(booking_row.channel_name, ''), '[\s._-]+', '', 'g'));
  IF normalized_channel LIKE '%airbnb%' OR normalized_channel LIKE '%booking%' OR normalized_channel LIKE '%expedia%' OR normalized_channel LIKE '%hotelscom%' OR normalized_channel LIKE '%vrbo%' OR normalized_channel LIKE '%homeaway%' THEN
    commission := LEAST(GREATEST(COALESCE(booking_row.platform_commission_amount, 0), 0), total);
    effective_paid_amount := GREATEST(total - commission, 0);
    effective_payment_status := CASE WHEN effective_paid_amount >= total THEN 'paid' WHEN effective_paid_amount > 0 THEN 'partial' ELSE 'unpaid' END;
  ELSE
    effective_paid_amount := COALESCE(booking_row.paid_amount, 0);
    effective_payment_status := booking_row.payment_status;
  END IF;

  INSERT INTO public.vihem_invoices (
    organisation_id, company_id, customer_id, invoice_date, due_date, payment_terms_days, currency,
    status, payment_status, source_type, source_id, subtotal_amount, vat_amount, total_amount,
    paid_amount, notes, created_by
  ) VALUES (
    booking_row.organisation_id, company_row.id, customer_row.id, CURRENT_DATE, CURRENT_DATE, 0,
    COALESCE(NULLIF(booking_row.currency, ''), company_row.default_currency, 'SEK'), 'draft',
    CASE WHEN effective_payment_status = 'paid' THEN 'paid' WHEN effective_payment_status = 'partial' THEN 'partially_paid' ELSE 'unpaid' END,
    'short_stay', booking_row.id, subtotal, vat_amount, total, effective_paid_amount,
    concat_ws(E'\n', 'Skapad från korttidsbokning.', 'Brutto: ' || total::text, 'Plattformsprovision: ' || commission::text, 'Nettoutbetalning: ' || effective_paid_amount::text), auth.uid()
  ) RETURNING * INTO invoice_row;

  line_index := 0;
  FOR line_row IN SELECT value FROM jsonb_array_elements(lines)
  LOOP
    line_index := line_index + 1;
    line_gross := round(GREATEST(COALESCE((line_row->>'amount')::numeric, 0), 0), 2);
    line_net := CASE WHEN vat_rate = 0 THEN line_gross ELSE round(line_gross / (1 + vat_rate / 100), 2) END;
    line_vat := line_gross - line_net;
    INSERT INTO public.vihem_invoice_lines (
      organisation_id, company_id, invoice_id, line_no, description, quantity, unit, unit_price,
      vat_rate, line_type, line_total_excl_vat, vat_amount, line_total_incl_vat, metadata
    ) VALUES (
      booking_row.organisation_id, company_row.id, invoice_row.id, line_index,
      COALESCE(NULLIF(line_row->>'description', ''), 'Korttidsboende'), 1, 'st', line_net,
      vat_rate, 'short_stay', line_net, line_vat, line_gross,
      jsonb_build_object('short_stay_booking_id', booking_row.id, 'channel_name', booking_row.channel_name, 'vat_exempt', booking_row.receipt_vat_exempt)
    );
  END LOOP;

  IF approve_invoice THEN invoice_row := public.vihem_approve_invoice(invoice_row.id, NULL); END IF;

  IF effective_paid_amount > 0 THEN
    INSERT INTO public.vihem_payments (
      organisation_id, company_id, invoice_id, payment_date, amount, currency, source, reference, external_payment_id, created_by
    ) VALUES (
      booking_row.organisation_id, company_row.id, invoice_row.id, CURRENT_DATE, effective_paid_amount,
      COALESCE(NULLIF(booking_row.currency, ''), company_row.default_currency, 'SEK'), 'accounting',
      COALESCE(NULLIF(booking_row.channel_name, ''), 'Korttidsbetalning'),
      COALESCE(NULLIF(booking_row.beds24_booking_id, ''), NULLIF(booking_row.external_uid, ''), booking_row.id::text), auth.uid()
    ) ON CONFLICT (company_id, external_payment_id) WHERE external_payment_id <> '' DO NOTHING;
    PERFORM public.vihem_recalculate_invoice_payment_status(invoice_row.id);
    SELECT * INTO invoice_row FROM public.vihem_invoices WHERE id = invoice_row.id;
  END IF;

  PERFORM public.vihem_upsert_short_stay_settlement(booking_row.id, company_row.id);
  UPDATE public.vihem_short_stay_bookings SET finance_invoice_id = invoice_row.id, updated_at = now() WHERE id = booking_row.id;
  RETURN invoice_row;
END;
$$;

NOTIFY pgrst, 'reload schema';
