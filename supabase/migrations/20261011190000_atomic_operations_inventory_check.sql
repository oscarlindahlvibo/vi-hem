BEGIN;
CREATE TABLE public.vihem_inventory_check_operations(actor_id uuid NOT NULL REFERENCES public.vihem_profiles(id),operation_id uuid NOT NULL,check_id uuid NOT NULL REFERENCES public.vihem_inventory_checks(id),request_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor_id,operation_id));
ALTER TABLE public.vihem_inventory_check_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vihem_inventory_check_operations FROM anon,authenticated;
GRANT ALL ON public.vihem_inventory_check_operations TO service_role;
CREATE FUNCTION public.vihem_complete_inventory_check(p_operation uuid,p_template uuid,p_snapshot jsonb,p_counts jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE caller public.vihem_profiles; target public.vihem_inventory_templates; previous public.vihem_inventory_check_operations; snapshot jsonb; result uuid;
 fingerprint text:=md5(jsonb_build_array(p_template,p_snapshot,p_counts)::text);
BEGIN
 SELECT * INTO caller FROM public.vihem_profiles WHERE id=auth.uid();
 IF caller.id IS NULL OR NOT caller.active OR caller.role NOT IN ('staff','admin','superadmin') OR caller.organisation_id IS NULL OR p_operation IS NULL THEN RAISE EXCEPTION 'Du saknar behörighet att spara kontrollen.' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(caller.id::text||p_operation::text,0));
 SELECT * INTO previous FROM public.vihem_inventory_check_operations WHERE actor_id=caller.id AND operation_id=p_operation;
 IF FOUND THEN
  IF previous.request_hash IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'Begäran har ändrats.' USING ERRCODE='22023'; END IF;
  SELECT id INTO result FROM public.vihem_inventory_checks WHERE id=previous.check_id AND organisation_id=caller.organisation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kontrollen är inte tillgänglig.' USING ERRCODE='42501'; END IF;
 ELSE
  SELECT * INTO target FROM public.vihem_inventory_templates WHERE id=p_template AND organisation_id=caller.organisation_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventarielistan är inte tillgänglig.' USING ERRCODE='42501'; END IF;
  PERFORM id FROM public.vihem_inventory_template_items WHERE template_id=p_template ORDER BY sort_order,id FOR SHARE;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label,'desired_quantity',desired_quantity,'unit',unit) ORDER BY sort_order,id),'[]'::jsonb) INTO snapshot FROM public.vihem_inventory_template_items WHERE template_id=p_template;
  IF snapshot IS DISTINCT FROM p_snapshot THEN RAISE EXCEPTION 'Listan har ändrats. Öppna kontrollen igen och jämför dina antal.' USING ERRCODE='P0001'; END IF;
  IF jsonb_typeof(p_counts) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Ange ett antal för varje artikel.' USING ERRCODE='22023'; END IF;
  IF jsonb_array_length(snapshot)=0 OR (SELECT count(*) FROM jsonb_object_keys(p_counts))<>jsonb_array_length(snapshot) OR EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot) i WHERE NOT p_counts ? (i->>'id') OR jsonb_typeof(p_counts->(i->>'id')) IS DISTINCT FROM 'number' OR (p_counts->>(i->>'id'))::numeric<0) THEN RAISE EXCEPTION 'Kontrollera samtliga antal. Ange noll om artikeln saknas.' USING ERRCODE='22023'; END IF;
  INSERT INTO public.vihem_inventory_checks(organisation_id,template_id,performed_by) VALUES(caller.organisation_id,p_template,caller.id) RETURNING id INTO result;
  INSERT INTO public.vihem_inventory_check_items(check_id,template_item_id,label,desired_quantity,unit,actual_quantity)
  SELECT result,(i->>'id')::uuid,i->>'label',(i->>'desired_quantity')::numeric,i->>'unit',(p_counts->>(i->>'id'))::numeric FROM jsonb_array_elements(snapshot) i;
  INSERT INTO public.vihem_inventory_check_operations(actor_id,operation_id,check_id,request_hash) VALUES(caller.id,p_operation,result,fingerprint);
 END IF;
 RETURN jsonb_build_object('id',result,'items',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id),'[]'::jsonb) FROM public.vihem_inventory_check_items i WHERE i.check_id=result));
END $$;
REVOKE ALL ON FUNCTION public.vihem_complete_inventory_check(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vihem_complete_inventory_check(uuid,uuid,jsonb,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
