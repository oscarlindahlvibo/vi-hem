BEGIN;
CREATE TABLE IF NOT EXISTS public.vihem_inventory_cart_operations (
 actor_id uuid NOT NULL REFERENCES public.vihem_profiles(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL, organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id),
 request_hash text NOT NULL, transaction_ids uuid[] NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor_id,operation_id)
);
ALTER TABLE public.vihem_inventory_cart_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vihem_inventory_cart_operations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.vihem_inventory_cart_operations TO service_role;
CREATE OR REPLACE FUNCTION public.vihem_checkout_inventory_cart(p_operation uuid,p_lines jsonb,p_source uuid,p_destination uuid,p_project uuid,p_apartment uuid,p_notes text)
RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE caller public.vihem_profiles; previous public.vihem_inventory_cart_operations; line jsonb; ids uuid[]:='{}';
 fingerprint text:=md5(jsonb_build_array(p_lines,p_source,p_destination,p_project,p_apartment,p_notes)::text);
BEGIN
 SELECT * INTO caller FROM public.vihem_profiles WHERE id=auth.uid();
 IF caller.id IS NULL OR NOT caller.active OR caller.role NOT IN ('admin','staff') OR caller.organisation_id IS NULL OR p_operation IS NULL THEN RAISE EXCEPTION 'Du saknar behörighet att hämta material.' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(caller.id::text||p_operation::text,0));
 SELECT * INTO previous FROM public.vihem_inventory_cart_operations WHERE actor_id=caller.id AND operation_id=p_operation;
 IF FOUND THEN
  IF previous.organisation_id IS DISTINCT FROM caller.organisation_id THEN RAISE EXCEPTION 'Registreringen är inte tillgänglig.' USING ERRCODE='42501'; END IF;
  IF previous.request_hash IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'Registreringen har ändrats.' USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) FROM public.vihem_inventory_transactions WHERE id=ANY(previous.transaction_ids) AND organisation_id=caller.organisation_id)<>cardinality(previous.transaction_ids) THEN RAISE EXCEPTION 'Registreringens historik är inte längre tillgänglig.' USING ERRCODE='42501'; END IF;
  RETURN previous.transaction_ids;
 END IF;
 IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Välj material.' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100 OR p_source IS NULL OR num_nonnulls(p_destination,p_project,p_apartment)<>1 OR p_source=p_destination THEN RAISE EXCEPTION 'Kontrollera material och destination.' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.vihem_inventory_locations WHERE id=p_source AND organisation_id=caller.organisation_id AND active) OR
 (p_destination IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vihem_inventory_locations WHERE id=p_destination AND organisation_id=caller.organisation_id AND active AND type='vehicle')) OR
 (p_project IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vihem_customer_projects WHERE id=p_project AND organisation_id=caller.organisation_id)) OR
 (p_apartment IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vihem_apartments WHERE id=p_apartment AND organisation_id=caller.organisation_id)) THEN RAISE EXCEPTION 'Välj objekt i din organisation.' USING ERRCODE='42501'; END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  IF jsonb_typeof(line)<>'object' OR (line-'item_id'-'quantity')<>'{}'::jsonb OR
   line->>'item_id' IS NULL OR line->>'quantity' IS NULL OR (line->>'quantity')::numeric<=0 OR
   (line->>'quantity')::numeric::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Kontrollera artiklar och antal.' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'item_id') FROM jsonb_array_elements(p_lines))<>jsonb_array_length(p_lines) THEN RAISE EXCEPTION 'En artikel får bara finnas på en rad.' USING ERRCODE='22023'; END IF;
 -- Same deterministic item lock order as other new inventory operations. All rows roll back on any error.
 FOR line IN SELECT value FROM jsonb_array_elements(p_lines) ORDER BY (value->>'item_id')::uuid LOOP
  PERFORM 1 FROM public.vihem_inventory_stock_items WHERE id=(line->>'item_id')::uuid AND organisation_id=caller.organisation_id AND active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Artikeln är inte tillgänglig.' USING ERRCODE='42501'; END IF;
 END LOOP;
 FOR line IN SELECT value FROM jsonb_array_elements(p_lines) ORDER BY (value->>'item_id')::uuid LOOP
  ids:=array_append(ids,public.vihem_inventory_apply_transaction((line->>'item_id')::uuid,(line->>'quantity')::numeric,
   CASE WHEN p_destination IS NOT NULL THEN 'transfer' ELSE 'stock_out' END,p_source,p_destination,p_project,NULL,'',coalesce(p_notes,''),p_apartment));
 END LOOP;
 INSERT INTO public.vihem_inventory_cart_operations(actor_id,operation_id,organisation_id,request_hash,transaction_ids) VALUES(caller.id,p_operation,caller.organisation_id,fingerprint,ids);
 RETURN ids;
END $$;
REVOKE ALL ON FUNCTION public.vihem_checkout_inventory_cart(uuid,jsonb,uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vihem_checkout_inventory_cart(uuid,jsonb,uuid,uuid,uuid,uuid,text) TO authenticated;
CREATE INDEX IF NOT EXISTS vihem_inventory_article_history_idx ON public.vihem_inventory_transactions(organisation_id,item_id,created_at DESC,id DESC);
NOTIFY pgrst,'reload schema';
COMMIT;
