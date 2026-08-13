-- Multi-product cart checkout and rental agreement signing for ViboRent.
ALTER TABLE public.vihem_rental_bookings
  ADD COLUMN IF NOT EXISTS contract_status text NOT NULL DEFAULT 'pending_signature',
  ADD COLUMN IF NOT EXISTS contract_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS contract_signature text,
  ADD COLUMN IF NOT EXISTS contract_signer_name text,
  ADD COLUMN IF NOT EXISTS contract_terms_version text NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS contract_terms_snapshot text NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vihem_rental_bookings_contract_status_check'
  ) THEN
    ALTER TABLE public.vihem_rental_bookings
      ADD CONSTRAINT vihem_rental_bookings_contract_status_check
      CHECK (contract_status = ANY (ARRAY['pending_signature','signed','not_required','cancelled']));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS vihem_rental_bookings_contract_status_idx
  ON public.vihem_rental_bookings(organisation_id, contract_status);

CREATE OR REPLACE FUNCTION public.vihem_create_rental_booking_multi(
  target_items jsonb,
  target_start_at timestamptz,
  target_end_at timestamptz,
  target_customer jsonb DEFAULT '{}'::jsonb,
  target_source text DEFAULT 'viborent.se',
  target_status text DEFAULT 'pending',
  target_customer_notes text DEFAULT ''
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item jsonb;
  product_row public.vihem_rental_products%ROWTYPE;
  quote_row jsonb;
  customer_id uuid;
  booking_id uuid;
  booking_reference text;
  product_id uuid;
  quantity integer;
  selected_count integer;
  selected_asset_ids jsonb;
  prepared_items jsonb := '[]'::jsonb;
  subtotal numeric := 0;
  vat numeric := 0;
  deposit numeric := 0;
  currency_code text := 'SEK';
  asset_row record;
  setting_row record;
  terms_snapshot text := 'ViboRent uthyrningsavtal v1';
  terms_url_value text := '';
  booking_org_id uuid;
BEGIN
  IF target_items IS NULL OR jsonb_typeof(target_items) <> 'array' OR jsonb_array_length(target_items) = 0 THEN
    RAISE EXCEPTION 'Varukorgen är tom.';
  END IF;
  IF target_end_at <= target_start_at THEN
    RAISE EXCEPTION 'Ogiltig bokningsperiod.';
  END IF;
  IF target_status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'Ogiltig bokningsstatus.';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(target_items) LOOP
    product_id := NULLIF(item->>'product_id', '')::uuid;
    quantity := GREATEST(1, COALESCE((item->>'quantity')::integer, 1));
    SELECT * INTO product_row
    FROM public.vihem_rental_products
    WHERE id = product_id AND active AND visible_publicly
    FOR UPDATE;
    IF product_row.id IS NULL THEN RAISE EXCEPTION 'Produkten hittades inte.'; END IF;
    IF booking_org_id IS NULL THEN
      booking_org_id := product_row.organisation_id;
    ELSIF booking_org_id <> product_row.organisation_id THEN
      RAISE EXCEPTION 'Varukorgen innehåller produkter från olika organisationer.';
    END IF;
    IF NOT public.vihem_rental_enabled(product_row.organisation_id) THEN
      RAISE EXCEPTION 'Uthyrning är inte aktiverad.';
    END IF;

    quote_row := public.vihem_rental_quote(product_id, target_start_at, target_end_at, quantity);
    subtotal := subtotal + (quote_row->>'subtotal')::numeric;
    vat := vat + (quote_row->>'vat_amount')::numeric;
    deposit := deposit + (quote_row->>'deposit')::numeric;
    currency_code := COALESCE(quote_row->>'currency', currency_code);
    selected_count := 0;
    selected_asset_ids := '[]'::jsonb;
    FOR asset_row IN
      SELECT a.id, a.name
      FROM public.vihem_rental_assets a
      WHERE a.product_id = product_id
        AND a.organisation_id = product_row.organisation_id
        AND a.active AND a.status = 'available'
        AND NOT EXISTS (
          SELECT 1 FROM public.vihem_rental_booking_items i
          JOIN public.vihem_rental_bookings b ON b.id = i.booking_id
          WHERE i.asset_id = a.id AND b.status IN ('pending','confirmed','active')
            AND b.start_at < target_end_at AND b.end_at > target_start_at
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.vihem_rental_blocks x
          WHERE x.asset_id = a.id AND x.start_at < target_end_at AND x.end_at > target_start_at
        )
      ORDER BY a.name
      FOR UPDATE OF a
    LOOP
      selected_count := selected_count + 1;
      selected_asset_ids := selected_asset_ids || jsonb_build_array(asset_row.id::text);
      IF selected_count >= quantity THEN EXIT; END IF;
    END LOOP;
    IF selected_count < quantity THEN
      RAISE EXCEPTION 'Produkten är inte tillgänglig under vald period.';
    END IF;
    prepared_items := prepared_items || jsonb_build_array(jsonb_build_object(
      'product_id', product_id, 'quantity', quantity, 'quote', quote_row,
      'asset_ids', selected_asset_ids
    ));
  END LOOP;

  SELECT id INTO customer_id
  FROM public.vihem_rental_customers
  WHERE organisation_id = product_row.organisation_id
    AND NULLIF(trim(COALESCE(target_customer->>'email', '')), '') IS NOT NULL
    AND lower(email) = lower(trim(target_customer->>'email'))
  ORDER BY created_at DESC LIMIT 1;
  IF customer_id IS NULL THEN
    INSERT INTO public.vihem_rental_customers (
      organisation_id, first_name, last_name, company_name, identifier,
      email, phone, address, postal_code, city, country, notes
    ) VALUES (
      product_row.organisation_id, COALESCE(target_customer->>'first_name',''),
      COALESCE(target_customer->>'last_name',''), COALESCE(target_customer->>'company_name',''),
      COALESCE(target_customer->>'identifier',''), COALESCE(target_customer->>'email',''),
      COALESCE(target_customer->>'phone',''), COALESCE(target_customer->>'address',''),
      COALESCE(target_customer->>'postal_code',''), COALESCE(target_customer->>'city',''),
      COALESCE(target_customer->>'country','SE'), COALESCE(target_customer->>'notes','')
    ) RETURNING id INTO customer_id;
  END IF;

  SELECT COALESCE((SELECT booking_prefix FROM public.vihem_rental_settings WHERE organisation_id = product_row.organisation_id), 'VR')
    || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
  INTO booking_reference;
  SELECT COALESCE(terms_url, '') INTO terms_url_value
  FROM public.vihem_rental_settings
  WHERE organisation_id = product_row.organisation_id;
  IF NULLIF(terms_url_value, '') IS NOT NULL THEN
    terms_snapshot := terms_snapshot || '. Villkor: ' || terms_url_value;
  END IF;

  INSERT INTO public.vihem_rental_bookings (
    public_reference, organisation_id, customer_id, status, payment_status,
    start_at, end_at, subtotal, vat_amount, deposit, total, currency,
    customer_notes, source, created_by, contract_status, contract_terms_snapshot
  ) VALUES (
    booking_reference, product_row.organisation_id, customer_id, target_status, 'unpaid',
    target_start_at, target_end_at, subtotal, vat, deposit, subtotal + vat,
    currency_code, target_customer_notes, COALESCE(NULLIF(trim(target_source),''),'viborent.se'),
    auth.uid(), 'pending_signature', terms_snapshot
  ) RETURNING id INTO booking_id;

  FOR item IN SELECT * FROM jsonb_array_elements(prepared_items) LOOP
    FOR asset_row IN SELECT value::uuid AS id FROM jsonb_array_elements_text(item->'asset_ids') LOOP
      INSERT INTO public.vihem_rental_booking_items (
        organisation_id, booking_id, product_id, asset_id, quantity, unit_price, total_price, pricing_snapshot
      ) VALUES (
        product_row.organisation_id, booking_id, (item->>'product_id')::uuid, asset_row.id, 1,
        ((item->'quote'->>'subtotal')::numeric / (item->>'quantity')::numeric),
        ((item->'quote'->>'subtotal')::numeric / (item->>'quantity')::numeric), item->'quote'
      );
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'id', booking_id, 'public_reference', booking_reference,
    'organisation_id', product_row.organisation_id, 'customer_id', customer_id,
    'contract_status', 'pending_signature',
    'quote', jsonb_build_object('subtotal', subtotal, 'vat_amount', vat, 'deposit', deposit,
      'total', subtotal + vat, 'currency', currency_code)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.vihem_create_rental_booking_multi(jsonb, timestamptz, timestamptz, jsonb, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vihem_create_rental_booking_multi(jsonb, timestamptz, timestamptz, jsonb, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
