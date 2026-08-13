-- Choose a pricing level by the actual rental duration.
-- The previous implementation used GREATEST across all rules, which could
-- make a short rental inherit a weekly price.
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
  duration_days numeric;
  base_price numeric := 0;
  selected_rule_id uuid;
  selected_rule_type text;
  selected_rule_price numeric;
  selected_rule_duration integer;
  vat_rate numeric := 25;
  subtotal numeric;
  vat numeric;
  is_weekend boolean;
BEGIN
  SELECT * INTO product_row
  FROM public.vihem_rental_products
  WHERE id = target_product_id;

  IF product_row.id IS NULL THEN RAISE EXCEPTION 'Produkten hittades inte.'; END IF;
  IF NOT public.vihem_rental_enabled(product_row.organisation_id) THEN RAISE EXCEPTION 'Uthyrning är inte aktiverad.'; END IF;
  IF target_end_at <= target_start_at OR target_quantity < 1 THEN RAISE EXCEPTION 'Ogiltig uthyrningsperiod.'; END IF;

  SELECT * INTO setting_row
  FROM public.vihem_rental_settings
  WHERE organisation_id = product_row.organisation_id;

  vat_rate := COALESCE(product_row.vat_rate, setting_row.vat_rate, 25);
  duration_hours := EXTRACT(EPOCH FROM (target_end_at - target_start_at)) / 3600;
  duration_days := duration_hours / 24;
  is_weekend := EXTRACT(ISODOW FROM target_start_at) IN (5, 6);

  -- Prefer an explicitly matching special rule, then select the smallest
  -- sensible billing unit for the requested period. A weekly rule is only
  -- eligible once the rental spans at least one full week.
  FOR rule_row IN
    SELECT *
    FROM public.vihem_rental_pricing_rules
    WHERE organisation_id = product_row.organisation_id
      AND product_id = product_row.id
      AND asset_id IS NULL
      AND active
      AND (valid_from IS NULL OR target_start_at::date >= valid_from)
      AND (valid_until IS NULL OR target_start_at::date <= valid_until)
      AND (
        rule_type IN ('fixed_period', 'custom')
        OR (rule_type = 'weekend' AND is_weekend AND duration_hours <= 72)
        OR (rule_type = 'hourly' AND duration_hours <= 24)
        OR (rule_type = 'daily' AND duration_hours <= 168)
        OR (rule_type = 'weekly' AND duration_hours >= 168)
      )
      AND (minimum_duration IS NULL OR duration_hours >= minimum_duration)
      AND (maximum_duration IS NULL OR duration_hours <= maximum_duration)
    ORDER BY
      priority DESC,
      CASE rule_type
        WHEN 'fixed_period' THEN 0
        WHEN 'custom' THEN 1
        WHEN 'weekend' THEN 2
        WHEN 'hourly' THEN 3
        WHEN 'daily' THEN 4
        WHEN 'weekly' THEN 5
        ELSE 6
      END,
      price ASC
  LOOP
    selected_rule_id := rule_row.id;
    selected_rule_type := rule_row.rule_type;
    selected_rule_price := rule_row.price;
    selected_rule_duration := GREATEST(COALESCE(rule_row.duration, 1), 1);
    EXIT;
  END LOOP;

  IF selected_rule_id IS NULL THEN
    RAISE EXCEPTION 'Ingen aktiv prisregel finns för den valda perioden.';
  END IF;

  IF selected_rule_type = 'hourly' THEN
    base_price := CEIL(duration_hours / selected_rule_duration) * selected_rule_price;
  ELSIF selected_rule_type = 'daily' THEN
    base_price := CEIL(duration_hours / (24 * selected_rule_duration)) * selected_rule_price;
  ELSIF selected_rule_type = 'weekly' THEN
    base_price := CEIL(duration_hours / (168 * selected_rule_duration)) * selected_rule_price;
  ELSE
    base_price := selected_rule_price;
  END IF;

  subtotal := round(base_price * target_quantity, 2);
  vat := round(subtotal * vat_rate / 100, 2);

  RETURN jsonb_build_object(
    'subtotal', subtotal,
    'vat_amount', vat,
    'total', subtotal + vat,
    'deposit', product_row.deposit * target_quantity,
    'currency', COALESCE(setting_row.currency, 'SEK'),
    'vat_rate', vat_rate,
    'rules', jsonb_build_array(jsonb_build_object(
      'id', selected_rule_id,
      'rule_type', selected_rule_type,
      'price', selected_rule_price,
      'duration', selected_rule_duration
    ))
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
