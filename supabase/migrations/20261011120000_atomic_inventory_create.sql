BEGIN;
CREATE TABLE public.vihem_inventory_create_operations (
 actor_id uuid NOT NULL REFERENCES public.vihem_profiles(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL,
 item_id uuid NOT NULL REFERENCES public.vihem_inventory_stock_items(id) ON DELETE CASCADE,
 request_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id, operation_id)
);
ALTER TABLE public.vihem_inventory_create_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vihem_inventory_create_operations FROM anon, authenticated;
GRANT ALL ON public.vihem_inventory_create_operations TO service_role;
CREATE FUNCTION public.vihem_create_inventory_item(p_operation uuid,p_item jsonb,p_quantity numeric DEFAULT 0,p_location uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE caller public.vihem_profiles; previous public.vihem_inventory_create_operations;
 result uuid; fingerprint text:=md5(jsonb_build_object('item',p_item,'quantity',p_quantity,'location',p_location)::text);
BEGIN
 SELECT * INTO caller FROM public.vihem_profiles WHERE id=auth.uid();
 IF caller.id IS NULL OR NOT caller.active OR caller.role <> 'admin' OR caller.organisation_id IS NULL THEN
  RAISE EXCEPTION 'Du saknar behörighet att skapa lagerartiklar.' USING ERRCODE='42501';
 END IF;
 IF p_operation IS NULL THEN RAISE EXCEPTION 'Sparbegäran saknar identifierare.' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(caller.id::text||p_operation::text,0));
 SELECT * INTO previous FROM public.vihem_inventory_create_operations WHERE actor_id=caller.id AND operation_id=p_operation;
 IF FOUND THEN
  IF previous.request_hash IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'Sparbegäran har ändrats.' USING ERRCODE='22023'; END IF;
  RETURN previous.item_id;
 END IF;
 IF jsonb_typeof(p_item) IS DISTINCT FROM 'object' OR nullif(trim(p_item->>'name'),'') IS NULL OR
  EXISTS(SELECT 1 FROM jsonb_object_keys(p_item) k WHERE k <> ALL(ARRAY['article_number','name','category','supplier','barcode','qr_identifier','unit','purchase_price','minimum_stock','target_stock','reorder_quantity','image_url','notes'])) OR
  p_quantity IS NULL OR p_quantity < 0 OR p_quantity::text IN ('NaN','Infinity','-Infinity') THEN
  RAISE EXCEPTION 'Kontrollera artikel och startsaldo.' USING ERRCODE='22023';
 END IF;
 IF p_quantity > 0 AND NOT EXISTS(SELECT 1 FROM public.vihem_inventory_locations WHERE id=p_location AND organisation_id=caller.organisation_id AND active) THEN
  RAISE EXCEPTION 'Välj en tillgänglig lagerplats i organisationen.' USING ERRCODE='42501';
 END IF;
 INSERT INTO public.vihem_inventory_stock_items(organisation_id,article_number,name,category,supplier,barcode,qr_identifier,unit,purchase_price,minimum_stock,target_stock,reorder_quantity,image_url,notes,created_by)
 VALUES(caller.organisation_id,coalesce(p_item->>'article_number',''),trim(p_item->>'name'),coalesce(p_item->>'category',''),coalesce(p_item->>'supplier',''),coalesce(p_item->>'barcode',''),coalesce(nullif(p_item->>'qr_identifier',''),gen_random_uuid()::text),coalesce(nullif(p_item->>'unit',''),'st'),coalesce((p_item->>'purchase_price')::numeric,0),coalesce((p_item->>'minimum_stock')::numeric,0),coalesce((p_item->>'target_stock')::numeric,0),coalesce((p_item->>'reorder_quantity')::numeric,0),coalesce(p_item->>'image_url',''),coalesce(p_item->>'notes',''),caller.id)
 RETURNING id INTO result;
 IF p_quantity>0 THEN
  PERFORM public.vihem_inventory_apply_transaction(result,p_quantity,'stock_in',NULL,p_location,NULL,NULL,'opening_balance','Startsaldo vid skapande av artikel',NULL);
 END IF;
 INSERT INTO public.vihem_inventory_create_operations(actor_id,operation_id,item_id,request_hash) VALUES(caller.id,p_operation,result,fingerprint);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.vihem_create_inventory_item(uuid,jsonb,numeric,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vihem_create_inventory_item(uuid,jsonb,numeric,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
