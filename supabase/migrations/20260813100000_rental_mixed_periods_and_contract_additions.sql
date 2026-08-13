-- Allow one ViboRent booking to contain products with independent periods.
ALTER TABLE public.vihem_rental_booking_items
  ADD COLUMN IF NOT EXISTS start_at timestamptz,
  ADD COLUMN IF NOT EXISTS end_at timestamptz;

UPDATE public.vihem_rental_booking_items i
SET start_at = b.start_at, end_at = b.end_at
FROM public.vihem_rental_bookings b
WHERE b.id = i.booking_id
  AND (i.start_at IS NULL OR i.end_at IS NULL);

ALTER TABLE public.vihem_rental_booking_items
  ALTER COLUMN start_at SET NOT NULL,
  ALTER COLUMN end_at SET NOT NULL;

-- Keep the legacy single-product booking RPC compatible with the new row periods.
CREATE OR REPLACE FUNCTION public.vihem_rental_booking_item_period_default()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.start_at IS NULL OR NEW.end_at IS NULL THEN
    SELECT start_at, end_at INTO NEW.start_at, NEW.end_at
    FROM public.vihem_rental_bookings
    WHERE id = NEW.booking_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vihem_rental_booking_item_period_default
  ON public.vihem_rental_booking_items;
CREATE TRIGGER vihem_rental_booking_item_period_default
  BEFORE INSERT ON public.vihem_rental_booking_items
  FOR EACH ROW EXECUTE FUNCTION public.vihem_rental_booking_item_period_default();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vihem_rental_booking_items_period_check'
  ) THEN
    ALTER TABLE public.vihem_rental_booking_items
      ADD CONSTRAINT vihem_rental_booking_items_period_check CHECK (end_at > start_at);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS vihem_rental_items_period_idx
  ON public.vihem_rental_booking_items(organisation_id, product_id, start_at, end_at);

CREATE OR REPLACE FUNCTION public.vihem_create_rental_booking_multi(
  target_items jsonb,
  target_customer jsonb DEFAULT '{}'::jsonb,
  target_source text DEFAULT 'viborent.se',
  target_status text DEFAULT 'pending',
  target_customer_notes text DEFAULT '',
  target_additional_terms text DEFAULT ''
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
  terms_snapshot text := 'ViboRent uthyrningsavtal v1';
  terms_url_value text := '';
  booking_org_id uuid;
  item_start_at timestamptz;
  item_end_at timestamptz;
  booking_start_at timestamptz;
  booking_end_at timestamptz;
BEGIN
  IF target_items IS NULL OR jsonb_typeof(target_items) <> 'array' OR jsonb_array_length(target_items) = 0 THEN
    RAISE EXCEPTION 'Varukorgen är tom.';
  END IF;
  IF target_status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'Ogiltig bokningsstatus.';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(target_items) LOOP
    product_id := NULLIF(item->>'product_id', '')::uuid;
    quantity := GREATEST(1, COALESCE((item->>'quantity')::integer, 1));
    item_start_at := NULLIF(item->>'start_at', '')::timestamptz;
    item_end_at := NULLIF(item->>'end_at', '')::timestamptz;
    IF item_start_at IS NULL OR item_end_at IS NULL OR item_end_at <= item_start_at THEN
      RAISE EXCEPTION 'Ogiltig period för en produkt.';
    END IF;
    booking_start_at := CASE WHEN booking_start_at IS NULL OR item_start_at < booking_start_at THEN item_start_at ELSE booking_start_at END;
    booking_end_at := CASE WHEN booking_end_at IS NULL OR item_end_at > booking_end_at THEN item_end_at ELSE booking_end_at END;

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

    quote_row := public.vihem_rental_quote(product_id, item_start_at, item_end_at, quantity);
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
            AND i.start_at < item_end_at AND i.end_at > item_start_at
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.vihem_rental_blocks x
          WHERE x.asset_id = a.id AND x.start_at < item_end_at AND x.end_at > item_start_at
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
      'asset_ids', selected_asset_ids, 'start_at', item_start_at, 'end_at', item_end_at
    ));
  END LOOP;

  SELECT id INTO customer_id
  FROM public.vihem_rental_customers
  WHERE organisation_id = booking_org_id
    AND NULLIF(trim(COALESCE(target_customer->>'email', '')), '') IS NOT NULL
    AND lower(email) = lower(trim(target_customer->>'email'))
  ORDER BY created_at DESC LIMIT 1;
  IF customer_id IS NULL THEN
    INSERT INTO public.vihem_rental_customers (
      organisation_id, first_name, last_name, company_name, identifier,
      email, phone, address, postal_code, city, country, notes
    ) VALUES (
      booking_org_id, COALESCE(target_customer->>'first_name',''), COALESCE(target_customer->>'last_name',''),
      COALESCE(target_customer->>'company_name',''), COALESCE(target_customer->>'identifier',''),
      COALESCE(target_customer->>'email',''), COALESCE(target_customer->>'phone',''),
      COALESCE(target_customer->>'address',''), COALESCE(target_customer->>'postal_code',''),
      COALESCE(target_customer->>'city',''), COALESCE(target_customer->>'country','SE'),
      COALESCE(target_customer->>'notes','')
    ) RETURNING id INTO customer_id;
  END IF;

  SELECT COALESCE((SELECT booking_prefix FROM public.vihem_rental_settings WHERE organisation_id = booking_org_id), 'VR')
    || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)) INTO booking_reference;
  SELECT COALESCE(terms_url, '') INTO terms_url_value
  FROM public.vihem_rental_settings WHERE organisation_id = booking_org_id;
  IF NULLIF(terms_url_value, '') IS NOT NULL THEN terms_snapshot := terms_snapshot || '. Villkor: ' || terms_url_value; END IF;
  IF NULLIF(trim(target_additional_terms), '') IS NOT NULL THEN
    terms_snapshot := terms_snapshot || E'\n\nAvtalskomplettering:\n' || trim(target_additional_terms);
  END IF;

  INSERT INTO public.vihem_rental_bookings (
    public_reference, organisation_id, customer_id, status, payment_status,
    start_at, end_at, subtotal, vat_amount, deposit, total, currency,
    customer_notes, source, created_by, contract_status, contract_terms_snapshot
  ) VALUES (
    booking_reference, booking_org_id, customer_id, target_status, 'unpaid',
    booking_start_at, booking_end_at, subtotal, vat, deposit, subtotal + vat,
    currency_code, target_customer_notes, COALESCE(NULLIF(trim(target_source),''),'viborent.se'),
    auth.uid(), 'pending_signature', terms_snapshot
  ) RETURNING id INTO booking_id;

  FOR item IN SELECT * FROM jsonb_array_elements(prepared_items) LOOP
    FOR asset_row IN SELECT value::uuid AS id FROM jsonb_array_elements_text(item->'asset_ids') LOOP
      INSERT INTO public.vihem_rental_booking_items (
        organisation_id, booking_id, product_id, asset_id, quantity, unit_price, total_price,
        pricing_snapshot, start_at, end_at
      ) VALUES (
        booking_org_id, booking_id, (item->>'product_id')::uuid, asset_row.id, 1,
        ((item->'quote'->>'subtotal')::numeric / (item->>'quantity')::numeric),
        ((item->'quote'->>'subtotal')::numeric / (item->>'quantity')::numeric), item->'quote',
        (item->>'start_at')::timestamptz, (item->>'end_at')::timestamptz
      );
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'id', booking_id, 'public_reference', booking_reference, 'organisation_id', booking_org_id,
    'customer_id', customer_id, 'contract_status', 'pending_signature',
    'quote', jsonb_build_object('subtotal', subtotal, 'vat_amount', vat, 'deposit', deposit,
      'total', subtotal + vat, 'currency', currency_code)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.vihem_create_rental_booking_multi(jsonb, jsonb, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vihem_create_rental_booking_multi(jsonb, jsonb, text, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
