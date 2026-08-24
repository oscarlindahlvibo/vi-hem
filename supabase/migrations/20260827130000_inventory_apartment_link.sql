-- Lager: gör det möjligt att registrera ett uttag mot en lägenhet, inte
-- bara ett kundprojekt eller en arbetsorder -- t.ex. material som
-- hämtas ut direkt till en specifik lägenhet vid en reparation.
-- Stödjer den nya varukorgs-baserade uttagsflödet i InventoryPage.tsx
-- (skanna flera artiklar, välj EN destination -- projekt, lägenhet
-- eller bilen -- och checka ut alla rader i samma session).

ALTER TABLE public.vihem_inventory_transactions
  ADD COLUMN IF NOT EXISTS apartment_id uuid REFERENCES public.vihem_apartments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS vihem_inventory_transactions_apartment_idx
  ON public.vihem_inventory_transactions(apartment_id, created_at DESC);

-- CREATE OR REPLACE only replaces a function with an IDENTICAL parameter
-- list; adding a new trailing parameter creates a second overload
-- instead, which then makes every call ambiguous. Drop the old
-- 9-parameter signature explicitly first.
DROP FUNCTION IF EXISTS public.vihem_inventory_apply_transaction(uuid, numeric, text, uuid, uuid, uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION public.vihem_inventory_apply_transaction(
  p_item_id uuid,
  p_quantity numeric,
  p_transaction_type text,
  p_source_location_id uuid DEFAULT NULL,
  p_destination_location_id uuid DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_work_order_id uuid DEFAULT NULL,
  p_other_reference text DEFAULT '',
  p_notes text DEFAULT '',
  p_apartment_id uuid DEFAULT NULL
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

  INSERT INTO public.vihem_inventory_transactions (organisation_id, item_id, quantity, transaction_type, source_location_id, destination_location_id, project_id, work_order_id, apartment_id, other_reference, unit_cost_snapshot, notes, created_by)
  VALUES (v_org, p_item_id, p_quantity, p_transaction_type, p_source_location_id, p_destination_location_id, p_project_id, p_work_order_id, p_apartment_id, COALESCE(p_other_reference, ''), COALESCE(v_cost, 0), COALESCE(p_notes, ''), v_user)
  RETURNING id INTO v_tx;
  RETURN v_tx;
END;
$$;

NOTIFY pgrst, 'reload schema';
