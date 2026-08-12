-- VI-HEM lager/material MVP. Rental assets and existing fixed-asset inventory
-- remain separate; this model tracks consumables through immutable movements.
INSERT INTO public.vihem_module_registry
  (module_key, name, description, category, default_enabled, sort_order)
VALUES
  ('inventory_management', 'Lager', 'Material, saldon, lagerplatser och uttag.', 'operations', false, 125)
ON CONFLICT (module_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  updated_at = now();

CREATE TABLE IF NOT EXISTS public.vihem_inventory_stock_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  article_number text NOT NULL DEFAULT '',
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  manufacturer text NOT NULL DEFAULT '',
  supplier text NOT NULL DEFAULT '',
  supplier_article_number text NOT NULL DEFAULT '',
  barcode text NOT NULL DEFAULT '',
  qr_identifier text NOT NULL DEFAULT '',
  unit text NOT NULL DEFAULT 'st',
  purchase_price numeric(12,2) NOT NULL DEFAULT 0,
  minimum_stock numeric(14,3) NOT NULL DEFAULT 0,
  target_stock numeric(14,3) NOT NULL DEFAULT 0,
  reorder_quantity numeric(14,3) NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, article_number)
);

CREATE TABLE IF NOT EXISTS public.vihem_inventory_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  parent_location_id uuid REFERENCES public.vihem_inventory_locations(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'other' CHECK (type IN ('site','building','warehouse','room','vehicle','shelf','bin','other')),
  code text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vihem_inventory_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.vihem_inventory_stock_items(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.vihem_inventory_locations(id) ON DELETE CASCADE,
  quantity numeric(14,3) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, item_id, location_id)
);

CREATE TABLE IF NOT EXISTS public.vihem_inventory_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.vihem_inventory_stock_items(id) ON DELETE RESTRICT,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  transaction_type text NOT NULL CHECK (transaction_type IN ('stock_in','stock_out','transfer','return','adjustment','inventory_adjustment','waste','correction')),
  source_location_id uuid REFERENCES public.vihem_inventory_locations(id) ON DELETE SET NULL,
  destination_location_id uuid REFERENCES public.vihem_inventory_locations(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.vihem_customer_projects(id) ON DELETE SET NULL,
  work_order_id uuid REFERENCES public.vihem_work_orders(id) ON DELETE SET NULL,
  other_reference text NOT NULL DEFAULT '',
  unit_cost_snapshot numeric(12,2) NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES public.vihem_profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vihem_inventory_stock_items_org_idx ON public.vihem_inventory_stock_items(organisation_id, active, name);
CREATE INDEX IF NOT EXISTS vihem_inventory_locations_org_idx ON public.vihem_inventory_locations(organisation_id, parent_location_id, active);
CREATE INDEX IF NOT EXISTS vihem_inventory_balances_item_idx ON public.vihem_inventory_balances(organisation_id, item_id, location_id);
CREATE INDEX IF NOT EXISTS vihem_inventory_transactions_org_idx ON public.vihem_inventory_transactions(organisation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vihem_inventory_transactions_project_idx ON public.vihem_inventory_transactions(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vihem_inventory_transactions_work_order_idx ON public.vihem_inventory_transactions(work_order_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.vihem_inventory_apply_transaction(
  p_item_id uuid,
  p_quantity numeric,
  p_transaction_type text,
  p_source_location_id uuid DEFAULT NULL,
  p_destination_location_id uuid DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_work_order_id uuid DEFAULT NULL,
  p_other_reference text DEFAULT '',
  p_notes text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.vihem_get_my_org_id();
  v_user uuid := auth.uid();
  v_cost numeric(12,2);
  v_tx uuid;
  v_available numeric(14,3);
BEGIN
  IF v_org IS NULL OR v_user IS NULL OR public.vihem_get_my_role() NOT IN ('staff','admin') THEN
    RAISE EXCEPTION 'Ingen behörighet för lagertransaktion';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'Antalet måste vara större än noll'; END IF;
  IF p_transaction_type NOT IN ('stock_in','stock_out','transfer','return','adjustment','inventory_adjustment','waste','correction') THEN
    RAISE EXCEPTION 'Ogiltig lagertyp';
  END IF;
  SELECT purchase_price INTO v_cost FROM public.vihem_inventory_stock_items
  WHERE id = p_item_id AND organisation_id = v_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lagerartikeln finns inte'; END IF;

  IF p_transaction_type IN ('stock_out','transfer','waste') THEN
    IF p_source_location_id IS NULL THEN RAISE EXCEPTION 'Källagerplats saknas'; END IF;
    SELECT quantity INTO v_available FROM public.vihem_inventory_balances
    WHERE organisation_id = v_org AND item_id = p_item_id AND location_id = p_source_location_id FOR UPDATE;
    IF COALESCE(v_available, 0) < p_quantity THEN RAISE EXCEPTION 'Otillräckligt saldo på vald lagerplats'; END IF;
    UPDATE public.vihem_inventory_balances SET quantity = quantity - p_quantity, updated_at = now()
    WHERE organisation_id = v_org AND item_id = p_item_id AND location_id = p_source_location_id;
  END IF;

  IF p_transaction_type IN ('stock_in','return','transfer','adjustment','inventory_adjustment','correction') THEN
    IF p_destination_location_id IS NULL THEN RAISE EXCEPTION 'Mållagerplats saknas'; END IF;
    INSERT INTO public.vihem_inventory_balances (organisation_id, item_id, location_id, quantity)
    VALUES (v_org, p_item_id, p_destination_location_id, p_quantity)
    ON CONFLICT (organisation_id, item_id, location_id) DO UPDATE SET quantity = public.vihem_inventory_balances.quantity + EXCLUDED.quantity, updated_at = now();
  END IF;

  INSERT INTO public.vihem_inventory_transactions (organisation_id, item_id, quantity, transaction_type, source_location_id, destination_location_id, project_id, work_order_id, other_reference, unit_cost_snapshot, notes, created_by)
  VALUES (v_org, p_item_id, p_quantity, p_transaction_type, p_source_location_id, p_destination_location_id, p_project_id, p_work_order_id, COALESCE(p_other_reference, ''), COALESCE(v_cost, 0), COALESCE(p_notes, ''), v_user)
  RETURNING id INTO v_tx;
  RETURN v_tx;
END;
$$;

ALTER TABLE public.vihem_inventory_stock_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_inventory_transactions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vihem_inventory_stock_items','vihem_inventory_locations','vihem_inventory_balances','vihem_inventory_transactions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Inventory org read %s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "Inventory org read %s" ON public.%I FOR SELECT TO authenticated USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_module_enabled(''inventory_management''))', t, t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Inventory staff manage items" ON public.vihem_inventory_stock_items;
CREATE POLICY "Inventory staff manage items" ON public.vihem_inventory_stock_items FOR ALL TO authenticated
USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_module_enabled('inventory_management') AND public.vihem_get_my_role() = 'admin')
WITH CHECK (organisation_id = public.vihem_get_my_org_id() AND public.vihem_module_enabled('inventory_management') AND public.vihem_get_my_role() = 'admin');

DROP POLICY IF EXISTS "Inventory admins manage locations" ON public.vihem_inventory_locations;
CREATE POLICY "Inventory admins manage locations" ON public.vihem_inventory_locations FOR ALL TO authenticated
USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_module_enabled('inventory_management') AND public.vihem_get_my_role() = 'admin')
WITH CHECK (organisation_id = public.vihem_get_my_org_id() AND public.vihem_module_enabled('inventory_management') AND public.vihem_get_my_role() = 'admin');

NOTIFY pgrst, 'reload schema';
