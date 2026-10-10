BEGIN;
CREATE TABLE IF NOT EXISTS public.vihem_inventory_movement_operations (
 actor_id uuid NOT NULL REFERENCES public.vihem_profiles(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL,
 transaction_id uuid NOT NULL REFERENCES public.vihem_inventory_transactions(id) ON DELETE CASCADE,
 request_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,operation_id)
);
ALTER TABLE public.vihem_inventory_movement_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vihem_inventory_movement_operations FROM anon,authenticated;
GRANT ALL ON public.vihem_inventory_movement_operations TO service_role;
CREATE OR REPLACE FUNCTION public.vihem_save_inventory_movement(p_operation uuid,p_item uuid,p_quantity numeric,p_type text,p_source uuid,p_destination uuid,p_project uuid,p_work_order uuid,p_notes text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE caller public.vihem_profiles; previous public.vihem_inventory_movement_operations; result uuid;
 fingerprint text:=md5(jsonb_build_array(p_item,p_quantity,p_type,p_source,p_destination,p_project,p_work_order,p_notes)::text);
BEGIN
 SELECT * INTO caller FROM public.vihem_profiles WHERE id=auth.uid();
 IF caller.id IS NULL OR NOT caller.active OR caller.role NOT IN ('staff','admin') OR caller.organisation_id IS NULL OR p_operation IS NULL THEN RAISE EXCEPTION 'Du saknar behörighet att registrera material.' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(caller.id::text||p_operation::text,0));
 SELECT * INTO previous FROM public.vihem_inventory_movement_operations WHERE actor_id=caller.id AND operation_id=p_operation;
 IF FOUND THEN
  IF previous.request_hash IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'Registreringen har ändrats.' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.vihem_inventory_transactions WHERE id=previous.transaction_id AND organisation_id=caller.organisation_id) THEN RAISE EXCEPTION 'Den tidigare registreringen är inte tillgänglig.' USING ERRCODE='42501'; END IF;
  RETURN previous.transaction_id;
 END IF;
 IF p_type NOT IN ('stock_in','stock_out','return','transfer') OR p_type IS NULL OR p_quantity IS NULL OR p_quantity<=0 OR p_quantity::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Kontrollera händelse och antal.' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.vihem_inventory_stock_items WHERE id=p_item AND organisation_id=caller.organisation_id AND active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Artikeln är inte tillgänglig.' USING ERRCODE='42501'; END IF;
 IF (p_source IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vihem_inventory_locations WHERE id=p_source AND organisation_id=caller.organisation_id AND active)) OR
 (p_destination IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vihem_inventory_locations WHERE id=p_destination AND organisation_id=caller.organisation_id AND active)) OR
 (p_project IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vihem_customer_projects WHERE id=p_project AND organisation_id=caller.organisation_id)) OR
 (p_work_order IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vihem_work_orders WHERE id=p_work_order AND organisation_id=caller.organisation_id)) THEN
  RAISE EXCEPTION 'Välj objekt i din organisation.' USING ERRCODE='42501';
 END IF;
 IF (p_type IN ('stock_in','return') AND (p_source IS NOT NULL OR p_destination IS NULL)) OR
 (p_type='stock_out' AND (p_source IS NULL OR p_destination IS NOT NULL)) OR
 (p_type='transfer' AND (p_source IS NULL OR p_destination IS NULL OR p_source=p_destination)) THEN RAISE EXCEPTION 'Kontrollera lagerplatserna.' USING ERRCODE='22023'; END IF;
 result:=public.vihem_inventory_apply_transaction(p_item,p_quantity,p_type,p_source,p_destination,p_project,p_work_order,'',coalesce(p_notes,''),NULL);
 INSERT INTO public.vihem_inventory_movement_operations(actor_id,operation_id,transaction_id,request_hash) VALUES(caller.id,p_operation,result,fingerprint);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.vihem_save_inventory_movement(uuid,uuid,numeric,text,uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vihem_save_inventory_movement(uuid,uuid,numeric,text,uuid,uuid,uuid,uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
