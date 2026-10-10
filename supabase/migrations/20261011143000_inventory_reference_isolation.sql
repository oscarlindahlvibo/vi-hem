-- Independent security candidate: preserve legacy signature and movement semantics.
-- Requires the existing 20260827130000 apartment-linked inventory model only.
BEGIN;
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
SET search_path = public, pg_temp
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
  IF NOT EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=v_user AND active) THEN RAISE EXCEPTION 'Kontot är inte aktivt' USING ERRCODE='42501'; END IF;
  IF (p_source_location_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vihem_inventory_locations WHERE id=p_source_location_id AND organisation_id=v_org)) OR
     (p_destination_location_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vihem_inventory_locations WHERE id=p_destination_location_id AND organisation_id=v_org)) OR
     (p_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vihem_customer_projects WHERE id=p_project_id AND organisation_id=v_org)) OR
     (p_work_order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vihem_work_orders WHERE id=p_work_order_id AND organisation_id=v_org)) OR
     (p_apartment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vihem_apartments WHERE id=p_apartment_id AND organisation_id=v_org)) THEN
    RAISE EXCEPTION 'Referensen tillhör inte din organisation' USING ERRCODE='42501';
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

REVOKE ALL ON FUNCTION public.vihem_inventory_apply_transaction(uuid,numeric,text,uuid,uuid,uuid,uuid,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vihem_inventory_apply_transaction(uuid,numeric,text,uuid,uuid,uuid,uuid,text,text,uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
