ALTER TABLE public.vihem_inventory_stock_items
  ADD COLUMN IF NOT EXISTS image_url text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS public.vihem_inventory_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  name text NOT NULL,
  location_id uuid REFERENCES public.vihem_inventory_locations(id) ON DELETE SET NULL,
  category text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','submitted','approved','cancelled')),
  started_by uuid NOT NULL REFERENCES public.vihem_profiles(id) ON DELETE RESTRICT,
  approved_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.vihem_inventory_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  count_id uuid NOT NULL REFERENCES public.vihem_inventory_counts(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.vihem_inventory_stock_items(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.vihem_inventory_locations(id) ON DELETE RESTRICT,
  expected_quantity numeric(14,3) NOT NULL DEFAULT 0,
  counted_quantity numeric(14,3) NOT NULL CHECK (counted_quantity >= 0),
  difference numeric(14,3) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (count_id, item_id, location_id)
);

CREATE INDEX IF NOT EXISTS vihem_inventory_counts_org_idx ON public.vihem_inventory_counts(organisation_id, status, started_at DESC);
CREATE INDEX IF NOT EXISTS vihem_inventory_count_lines_count_idx ON public.vihem_inventory_count_lines(count_id, item_id, location_id);

CREATE OR REPLACE FUNCTION public.vihem_inventory_record_count(
  p_count_id uuid,
  p_item_id uuid,
  p_location_id uuid,
  p_counted_quantity numeric
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := public.vihem_get_my_org_id();
  v_line uuid;
  v_expected numeric(14,3);
BEGIN
  IF v_org IS NULL OR public.vihem_get_my_role() NOT IN ('staff','admin') THEN RAISE EXCEPTION 'Ingen behörighet för inventering'; END IF;
  IF p_counted_quantity IS NULL OR p_counted_quantity < 0 THEN RAISE EXCEPTION 'Räknat antal kan inte vara negativt'; END IF;
  SELECT COALESCE(quantity, 0) INTO v_expected FROM public.vihem_inventory_balances
    WHERE organisation_id = v_org AND item_id = p_item_id AND location_id = p_location_id;
  INSERT INTO public.vihem_inventory_count_lines (organisation_id, count_id, item_id, location_id, expected_quantity, counted_quantity, difference)
  VALUES (v_org, p_count_id, p_item_id, p_location_id, COALESCE(v_expected, 0), p_counted_quantity, p_counted_quantity - COALESCE(v_expected, 0))
  ON CONFLICT (count_id, item_id, location_id) DO UPDATE SET
    counted_quantity = EXCLUDED.counted_quantity,
    expected_quantity = EXCLUDED.expected_quantity,
    difference = EXCLUDED.difference
  RETURNING id INTO v_line;
  RETURN v_line;
END;
$$;

CREATE OR REPLACE FUNCTION public.vihem_inventory_approve_count(p_count_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := public.vihem_get_my_org_id();
  v_user uuid := auth.uid();
  line record;
  v_changed integer := 0;
  v_quantity numeric(14,3);
BEGIN
  IF v_org IS NULL OR v_user IS NULL OR public.vihem_get_my_role() <> 'admin' THEN RAISE EXCEPTION 'Endast admin kan godkänna inventering'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vihem_inventory_counts WHERE id = p_count_id AND organisation_id = v_org AND status IN ('open','submitted')) THEN RAISE EXCEPTION 'Inventeringen finns inte eller är redan godkänd'; END IF;
  FOR line IN SELECT * FROM public.vihem_inventory_count_lines WHERE count_id = p_count_id AND organisation_id = v_org LOOP
    IF line.difference <> 0 THEN
      v_quantity := abs(line.difference);
      IF line.difference > 0 THEN
        INSERT INTO public.vihem_inventory_balances (organisation_id,item_id,location_id,quantity)
        VALUES (v_org,line.item_id,line.location_id,v_quantity)
        ON CONFLICT (organisation_id,item_id,location_id) DO UPDATE SET quantity = public.vihem_inventory_balances.quantity + EXCLUDED.quantity, updated_at = now();
      ELSE
        IF NOT EXISTS (
          SELECT 1 FROM public.vihem_inventory_balances
          WHERE organisation_id=v_org AND item_id=line.item_id AND location_id=line.location_id
            AND quantity >= v_quantity
        ) THEN
          RAISE EXCEPTION 'Inventeringsdifferensen skulle ge negativt saldo för artikeln';
        END IF;
        UPDATE public.vihem_inventory_balances SET quantity = quantity - v_quantity, updated_at = now()
        WHERE organisation_id=v_org AND item_id=line.item_id AND location_id=line.location_id;
      END IF;
      INSERT INTO public.vihem_inventory_transactions (organisation_id,item_id,quantity,transaction_type,source_location_id,destination_location_id,other_reference,unit_cost_snapshot,notes,created_by)
      SELECT v_org,line.item_id,v_quantity,'inventory_adjustment',CASE WHEN line.difference < 0 THEN line.location_id END,CASE WHEN line.difference > 0 THEN line.location_id END,'inventory_count',purchase_price,format('Inventering: differens %s', line.difference),v_user
      FROM public.vihem_inventory_stock_items WHERE id=line.item_id AND organisation_id=v_org;
      v_changed := v_changed + 1;
    END IF;
  END LOOP;
  UPDATE public.vihem_inventory_counts SET status='approved', approved_by=v_user, approved_at=now() WHERE id=p_count_id AND organisation_id=v_org;
  RETURN v_changed;
END;
$$;

ALTER TABLE public.vihem_inventory_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_inventory_count_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Inventory counts org read" ON public.vihem_inventory_counts;
CREATE POLICY "Inventory counts org read" ON public.vihem_inventory_counts FOR SELECT TO authenticated
USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_module_enabled('inventory_management'));
DROP POLICY IF EXISTS "Inventory counts staff write" ON public.vihem_inventory_counts;
CREATE POLICY "Inventory counts staff write" ON public.vihem_inventory_counts FOR INSERT TO authenticated
WITH CHECK (organisation_id = public.vihem_get_my_org_id() AND public.vihem_module_enabled('inventory_management') AND public.vihem_get_my_role() IN ('staff','admin'));
DROP POLICY IF EXISTS "Inventory counts admin update" ON public.vihem_inventory_counts;
CREATE POLICY "Inventory counts admin update" ON public.vihem_inventory_counts FOR UPDATE TO authenticated
USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_module_enabled('inventory_management') AND public.vihem_get_my_role() = 'admin')
WITH CHECK (organisation_id = public.vihem_get_my_org_id() AND public.vihem_module_enabled('inventory_management') AND public.vihem_get_my_role() = 'admin');
DROP POLICY IF EXISTS "Inventory count lines org read" ON public.vihem_inventory_count_lines;
CREATE POLICY "Inventory count lines org read" ON public.vihem_inventory_count_lines FOR SELECT TO authenticated
USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_module_enabled('inventory_management'));

NOTIFY pgrst, 'reload schema';
