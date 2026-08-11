-- ViboRent uthyrningsmodul: organisationer, produkter, assets, priser,
-- kunder, bokningar och interna spärrar. Allt är tenant-scoped.

INSERT INTO public.vihem_module_registry
  (module_key, name, description, category, default_enabled, default_limits, default_settings, sort_order)
VALUES
  ('rental_management', 'Uthyrning', 'Produkter, assets, priser, kunder, bokningar och interna spärrar.', 'rental', false, '{"max_products": 5000, "max_bookings_per_month": 10000}'::jsonb, '{"currency":"SEK","vat_rate":25,"timezone":"Europe/Stockholm"}'::jsonb, 175)
ON CONFLICT (module_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  default_limits = EXCLUDED.default_limits,
  default_settings = EXCLUDED.default_settings,
  updated_at = now();

INSERT INTO public.vihem_organisation_modules (organisation_id, module_key, enabled, limits, settings)
SELECT o.id, 'rental_management', false, r.default_limits, r.default_settings
FROM public.vihem_organisations o
JOIN public.vihem_module_registry r ON r.module_key = 'rental_management'
ON CONFLICT (organisation_id, module_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.vihem_rental_enabled(target_organisation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vihem_organisation_modules
    WHERE organisation_id = target_organisation_id
      AND module_key = 'rental_management'
      AND enabled
  );
$$;

CREATE TABLE IF NOT EXISTS public.vihem_rental_settings (
  organisation_id uuid PRIMARY KEY REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  currency text NOT NULL DEFAULT 'SEK',
  vat_rate numeric(6,2) NOT NULL DEFAULT 25,
  timezone text NOT NULL DEFAULT 'Europe/Stockholm',
  booking_prefix text NOT NULL DEFAULT 'VR',
  minimum_advance_hours integer NOT NULL DEFAULT 0,
  maximum_advance_days integer NOT NULL DEFAULT 730,
  default_return_buffer_minutes integer NOT NULL DEFAULT 0,
  cancellation_policy text NOT NULL DEFAULT '',
  customer_support_email text NOT NULL DEFAULT '',
  customer_support_phone text NOT NULL DEFAULT '',
  terms_url text NOT NULL DEFAULT '',
  privacy_url text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vihem_rental_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  description text NOT NULL DEFAULT '',
  short_description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  visible_publicly boolean NOT NULL DEFAULT false,
  vat_rate numeric(6,2),
  deposit numeric(14,2) NOT NULL DEFAULT 0,
  quantity integer NOT NULL DEFAULT 0,
  minimum_duration integer NOT NULL DEFAULT 1,
  maximum_duration integer,
  pickup_instructions text NOT NULL DEFAULT '',
  return_instructions text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  seo_title text NOT NULL DEFAULT '',
  seo_description text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, slug)
);

CREATE TABLE IF NOT EXISTS public.vihem_rental_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.vihem_rental_products(id) ON DELETE CASCADE,
  name text NOT NULL,
  internal_identifier text NOT NULL DEFAULT '',
  registration_number text NOT NULL DEFAULT '',
  serial_number text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','rented','maintenance','inactive')),
  active boolean NOT NULL DEFAULT true,
  location text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  access_device_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, internal_identifier)
);

CREATE TABLE IF NOT EXISTS public.vihem_rental_pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.vihem_rental_products(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES public.vihem_rental_assets(id) ON DELETE CASCADE,
  rule_type text NOT NULL CHECK (rule_type IN ('hourly','daily','weekend','weekly','fixed_period','custom')),
  price numeric(14,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'SEK',
  duration integer NOT NULL DEFAULT 1,
  duration_unit text NOT NULL DEFAULT 'day' CHECK (duration_unit IN ('hour','day','week')),
  valid_from date,
  valid_until date,
  day_of_week smallint[] NOT NULL DEFAULT '{}'::smallint[],
  start_time time,
  end_time time,
  minimum_duration integer,
  maximum_duration integer,
  priority integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vihem_rental_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  company_name text NOT NULL DEFAULT '',
  identifier text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  postal_code text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  country text NOT NULL DEFAULT 'SE',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vihem_rental_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference text NOT NULL UNIQUE,
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.vihem_rental_customers(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','confirmed','active','completed','cancelled')),
  payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','pending','paid','refunded','partially_refunded')),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  vat_amount numeric(14,2) NOT NULL DEFAULT 0,
  discount numeric(14,2) NOT NULL DEFAULT 0,
  deposit numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'SEK',
  customer_notes text NOT NULL DEFAULT '',
  internal_notes text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'vihem',
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);

CREATE TABLE IF NOT EXISTS public.vihem_rental_booking_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.vihem_rental_bookings(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.vihem_rental_products(id) ON DELETE RESTRICT,
  asset_id uuid REFERENCES public.vihem_rental_assets(id) ON DELETE RESTRICT,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric(14,2) NOT NULL DEFAULT 0,
  total_price numeric(14,2) NOT NULL DEFAULT 0,
  pricing_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.vihem_rental_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.vihem_rental_products(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES public.vihem_rental_assets(id) ON DELETE CASCADE,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  block_type text NOT NULL DEFAULT 'internal_use' CHECK (block_type IN ('internal_use','maintenance','admin_block','unavailable')),
  reason text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);

CREATE INDEX IF NOT EXISTS vihem_rental_products_org_idx ON public.vihem_rental_products(organisation_id, active, visible_publicly);
CREATE INDEX IF NOT EXISTS vihem_rental_assets_product_idx ON public.vihem_rental_assets(organisation_id, product_id, status);
CREATE INDEX IF NOT EXISTS vihem_rental_prices_product_idx ON public.vihem_rental_pricing_rules(organisation_id, product_id, active, priority);
CREATE INDEX IF NOT EXISTS vihem_rental_bookings_period_idx ON public.vihem_rental_bookings(organisation_id, start_at, end_at, status);
CREATE INDEX IF NOT EXISTS vihem_rental_items_asset_idx ON public.vihem_rental_booking_items(organisation_id, asset_id);
CREATE INDEX IF NOT EXISTS vihem_rental_blocks_period_idx ON public.vihem_rental_blocks(organisation_id, product_id, asset_id, start_at, end_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vihem_rental_settings','vihem_rental_products','vihem_rental_assets','vihem_rental_pricing_rules','vihem_rental_customers','vihem_rental_bookings','vihem_rental_booking_items','vihem_rental_blocks'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Rental org access" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Rental org access" ON public.%I FOR SELECT TO authenticated USING (organisation_id = public.get_my_org_id() AND public.vihem_rental_enabled(organisation_id))', t);
    EXECUTE format('DROP POLICY IF EXISTS "Rental staff manage" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Rental staff manage" ON public.%I FOR ALL TO authenticated USING (organisation_id = public.get_my_org_id() AND public.vihem_rental_enabled(organisation_id) AND public.get_my_role() = ANY(ARRAY[''staff'',''admin''])) WITH CHECK (organisation_id = public.get_my_org_id() AND public.vihem_rental_enabled(organisation_id) AND public.get_my_role() = ANY(ARRAY[''staff'',''admin'']))', t);
  END LOOP;
  EXECUTE 'ALTER TABLE public.vihem_rental_settings ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS "Rental settings admin" ON public.vihem_rental_settings';
  EXECUTE 'CREATE POLICY "Rental settings admin" ON public.vihem_rental_settings FOR ALL TO authenticated USING (organisation_id = public.get_my_org_id() AND public.get_my_role() = ''admin'') WITH CHECK (organisation_id = public.get_my_org_id() AND public.get_my_role() = ''admin'')';
  EXECUTE 'DROP POLICY IF EXISTS "Rental staff manage" ON public.vihem_rental_settings';
END $$;

CREATE OR REPLACE FUNCTION public.vihem_rental_quote(
  target_product_id uuid,
  target_start_at timestamptz,
  target_end_at timestamptz,
  target_quantity integer DEFAULT 1
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  product_row public.vihem_rental_products%ROWTYPE;
  setting_row public.vihem_rental_settings%ROWTYPE;
  rule_row record;
  duration_hours numeric;
  base_price numeric := 0;
  applied jsonb := '[]'::jsonb;
  vat_rate numeric := 25;
  subtotal numeric;
  vat numeric;
BEGIN
  SELECT * INTO product_row FROM public.vihem_rental_products WHERE id = target_product_id;
  IF product_row.id IS NULL THEN RAISE EXCEPTION 'Produkten hittades inte.'; END IF;
  IF NOT public.vihem_rental_enabled(product_row.organisation_id) THEN RAISE EXCEPTION 'Uthyrning är inte aktiverad.'; END IF;
  IF target_end_at <= target_start_at OR target_quantity < 1 THEN RAISE EXCEPTION 'Ogiltig uthyrningsperiod.'; END IF;
  SELECT * INTO setting_row FROM public.vihem_rental_settings WHERE organisation_id = product_row.organisation_id;
  vat_rate := COALESCE(product_row.vat_rate, setting_row.vat_rate, 25);
  duration_hours := EXTRACT(EPOCH FROM (target_end_at - target_start_at)) / 3600;
  FOR rule_row IN
    SELECT * FROM public.vihem_rental_pricing_rules
    WHERE organisation_id = product_row.organisation_id AND product_id = product_row.id AND asset_id IS NULL AND active
      AND (valid_from IS NULL OR target_start_at::date >= valid_from)
      AND (valid_until IS NULL OR target_start_at::date <= valid_until)
    ORDER BY priority DESC, CASE rule_type WHEN 'fixed_period' THEN 0 WHEN 'weekend' THEN 1 WHEN 'weekly' THEN 2 WHEN 'daily' THEN 3 ELSE 4 END
  LOOP
    IF rule_row.rule_type = 'hourly' THEN
      base_price := GREATEST(base_price, CEIL(duration_hours / GREATEST(rule_row.duration, 1)) * rule_row.price);
    ELSIF rule_row.rule_type = 'daily' THEN
      base_price := GREATEST(base_price, CEIL(duration_hours / 24 / GREATEST(rule_row.duration, 1)) * rule_row.price);
    ELSIF rule_row.rule_type = 'weekly' THEN
      base_price := GREATEST(base_price, CEIL(duration_hours / 168 / GREATEST(rule_row.duration, 1)) * rule_row.price);
    ELSIF rule_row.rule_type = 'weekend' AND EXTRACT(ISODOW FROM target_start_at) IN (5,6) THEN
      base_price := GREATEST(base_price, rule_row.price);
    ELSIF rule_row.rule_type IN ('fixed_period','custom') THEN
      base_price := GREATEST(base_price, rule_row.price);
    END IF;
    IF base_price > 0 THEN applied := applied || jsonb_build_array(jsonb_build_object('id', rule_row.id, 'rule_type', rule_row.rule_type, 'price', rule_row.price)); END IF;
  END LOOP;
  IF base_price = 0 THEN RAISE EXCEPTION 'Ingen aktiv prisregel finns för produkten.'; END IF;
  subtotal := round(base_price * target_quantity, 2);
  vat := round(subtotal * vat_rate / 100, 2);
  RETURN jsonb_build_object('subtotal', subtotal, 'vat_amount', vat, 'total', subtotal + vat, 'deposit', product_row.deposit * target_quantity, 'currency', COALESCE(setting_row.currency, 'SEK'), 'vat_rate', vat_rate, 'rules', applied);
END;
$$;

CREATE OR REPLACE FUNCTION public.vihem_rental_available_assets(
  target_product_id uuid,
  target_start_at timestamptz,
  target_end_at timestamptz
)
RETURNS TABLE(asset_id uuid, asset_name text) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.name
  FROM public.vihem_rental_assets a
  WHERE a.product_id = target_product_id AND a.active AND a.status = 'available'
    AND public.vihem_rental_enabled(a.organisation_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.vihem_rental_booking_items i JOIN public.vihem_rental_bookings b ON b.id = i.booking_id
      WHERE i.asset_id = a.id AND b.status IN ('pending','confirmed','active') AND b.start_at < target_end_at AND b.end_at > target_start_at
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.vihem_rental_blocks x
      WHERE x.asset_id = a.id AND x.start_at < target_end_at AND x.end_at > target_start_at
    );
$$;

REVOKE ALL ON FUNCTION public.vihem_rental_quote(uuid, timestamptz, timestamptz, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.vihem_rental_available_assets(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vihem_rental_quote(uuid, timestamptz, timestamptz, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vihem_rental_available_assets(uuid, timestamptz, timestamptz) TO authenticated, service_role;

-- Publika integrationsklienter ska inte skriva direkt mot tabellerna. Denna
-- funktion är den enda bokningsvägen och utför kontroll, pris och asset-val i
-- samma transaktion.
CREATE OR REPLACE FUNCTION public.vihem_create_rental_booking(
  target_product_id uuid,
  target_start_at timestamptz,
  target_end_at timestamptz,
  target_quantity integer DEFAULT 1,
  target_customer jsonb DEFAULT '{}'::jsonb,
  target_source text DEFAULT 'vihem',
  target_status text DEFAULT 'confirmed',
  target_customer_notes text DEFAULT '',
  target_internal_notes text DEFAULT ''
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  product_row public.vihem_rental_products%ROWTYPE;
  quote_row jsonb;
  customer_id uuid;
  booking_id uuid;
  booking_reference text;
  selected_asset uuid;
  selected_count integer := 0;
  asset_row record;
BEGIN
  IF target_quantity < 1 OR target_end_at <= target_start_at THEN
    RAISE EXCEPTION 'Ogiltig bokningsperiod eller kvantitet.';
  END IF;
  IF target_status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'Ogiltig bokningsstatus.';
  END IF;

  -- Serialiserar bokningar för samma produkt under transaktionen.
  SELECT * INTO product_row
  FROM public.vihem_rental_products
  WHERE id = target_product_id
  FOR UPDATE;
  IF product_row.id IS NULL THEN RAISE EXCEPTION 'Produkten hittades inte.'; END IF;
  IF NOT public.vihem_rental_enabled(product_row.organisation_id) THEN
    RAISE EXCEPTION 'Uthyrning är inte aktiverad.';
  END IF;

  quote_row := public.vihem_rental_quote(target_product_id, target_start_at, target_end_at, target_quantity);

  FOR asset_row IN
    SELECT a.id, a.name
    FROM public.vihem_rental_assets a
    WHERE a.product_id = target_product_id AND a.organisation_id = product_row.organisation_id
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
    IF selected_count >= target_quantity THEN EXIT; END IF;
  END LOOP;
  IF selected_count < target_quantity THEN
    RAISE EXCEPTION 'Produkten är inte tillgänglig under vald period.';
  END IF;

  IF NULLIF(trim(COALESCE(target_customer->>'email', '')), '') IS NOT NULL THEN
    SELECT id INTO customer_id
    FROM public.vihem_rental_customers
    WHERE organisation_id = product_row.organisation_id
      AND lower(email) = lower(trim(target_customer->>'email'))
    ORDER BY created_at DESC LIMIT 1;
  END IF;
  IF customer_id IS NULL THEN
    INSERT INTO public.vihem_rental_customers (
      organisation_id, first_name, last_name, company_name, identifier,
      email, phone, address, postal_code, city, country, notes
    ) VALUES (
      product_row.organisation_id,
      COALESCE(target_customer->>'first_name', ''),
      COALESCE(target_customer->>'last_name', ''),
      COALESCE(target_customer->>'company_name', ''),
      COALESCE(target_customer->>'identifier', ''),
      COALESCE(target_customer->>'email', ''),
      COALESCE(target_customer->>'phone', ''),
      COALESCE(target_customer->>'address', ''),
      COALESCE(target_customer->>'postal_code', ''),
      COALESCE(target_customer->>'city', ''),
      COALESCE(target_customer->>'country', 'SE'),
      COALESCE(target_customer->>'notes', '')
    ) RETURNING id INTO customer_id;
  END IF;

  SELECT COALESCE((SELECT booking_prefix FROM public.vihem_rental_settings WHERE organisation_id = product_row.organisation_id), 'VR')
    || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
  INTO booking_reference;

  INSERT INTO public.vihem_rental_bookings (
    public_reference, organisation_id, customer_id, status, start_at, end_at,
    subtotal, vat_amount, deposit, total, currency, customer_notes, internal_notes,
    source, created_by
  ) VALUES (
    booking_reference, product_row.organisation_id, customer_id, target_status,
    target_start_at, target_end_at,
    (quote_row->>'subtotal')::numeric, (quote_row->>'vat_amount')::numeric,
    (quote_row->>'deposit')::numeric, (quote_row->>'total')::numeric,
    COALESCE(quote_row->>'currency', 'SEK'), target_customer_notes, target_internal_notes,
    COALESCE(NULLIF(trim(target_source), ''), 'vihem'), auth.uid()
  ) RETURNING id INTO booking_id;

  -- MVP tilldelar en asset per bokningsrad. Flera assets stöds genom flera rader.
  FOR asset_row IN
    SELECT a.id, a.name
    FROM public.vihem_rental_assets a
    WHERE a.product_id = target_product_id AND a.organisation_id = product_row.organisation_id
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
    LIMIT target_quantity
  LOOP
    INSERT INTO public.vihem_rental_booking_items (
      organisation_id, booking_id, product_id, asset_id, quantity, unit_price, total_price, pricing_snapshot
    ) VALUES (
      product_row.organisation_id, booking_id, target_product_id, asset_row.id, 1,
      (quote_row->>'subtotal')::numeric / target_quantity,
      (quote_row->>'subtotal')::numeric / target_quantity,
      quote_row
    );
  END LOOP;

  RETURN jsonb_build_object(
    'id', booking_id,
    'public_reference', booking_reference,
    'organisation_id', product_row.organisation_id,
    'customer_id', customer_id,
    'quote', quote_row
  );
END;
$$;

REVOKE ALL ON FUNCTION public.vihem_create_rental_booking(uuid, timestamptz, timestamptz, integer, jsonb, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vihem_create_rental_booking(uuid, timestamptz, timestamptz, integer, jsonb, text, text, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
