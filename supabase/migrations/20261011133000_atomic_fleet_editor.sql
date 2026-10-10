BEGIN;
CREATE TABLE IF NOT EXISTS public.vihem_fleet_save_operations (
 actor_id uuid NOT NULL REFERENCES public.vihem_profiles(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL,
 vehicle_id uuid NOT NULL REFERENCES public.vihem_fleet_vehicles(id) ON DELETE CASCADE,
 request_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor_id,operation_id)
);
ALTER TABLE public.vihem_fleet_save_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vihem_fleet_save_operations FROM anon,authenticated;
GRANT ALL ON public.vihem_fleet_save_operations TO service_role;
CREATE OR REPLACE FUNCTION public.vihem_save_fleet_editor(p_operation uuid,p_vehicle uuid,p_expected timestamptz,p_fields jsonb,p_inspection jsonb,p_source jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE caller public.vihem_profiles; target public.vihem_fleet_vehicles; previous public.vihem_fleet_save_operations;
 fields jsonb; cols text; v_result uuid; inspection_id uuid; ref uuid;
 fingerprint text:=md5(jsonb_build_array(p_vehicle,p_expected,p_fields,p_inspection,p_source)::text);
 allowed text[]:=ARRAY['asset_type','name','registration_number','internal_number','make','model','model_year','vin','serial_number','company_id','responsible_user_id','property_id','purchase_date','purchase_price','financing_type','financing_notes','current_odometer','odometer_unit','engine_hours','fuel_type','registration_status','status','notes','color','transmission','curb_weight_kg','gross_weight_kg','max_load_kg','trailer_weight_braked_kg','trailer_weight_unbraked_kg','length_mm','width_mm','height_mm','number_of_seats','co2_g_km','euro_class','technical_specs'];
BEGIN
 SELECT * INTO caller FROM public.vihem_profiles WHERE id=auth.uid();
 IF caller.id IS NULL OR NOT caller.active OR caller.role NOT IN ('admin','superadmin') OR caller.organisation_id IS NULL OR NOT public.vihem_module_enabled('fleet_management') OR p_operation IS NULL THEN RAISE EXCEPTION 'Du saknar behörighet att spara tillgången.' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(caller.id::text||p_operation::text,0));
 SELECT * INTO previous FROM public.vihem_fleet_save_operations WHERE actor_id=caller.id AND operation_id=p_operation;
 IF FOUND THEN
  IF previous.request_hash IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'Sparbegäran har ändrats.' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.vihem_fleet_vehicles WHERE id=previous.vehicle_id AND organisation_id=caller.organisation_id) THEN RAISE EXCEPTION 'Den tidigare registreringen är inte tillgänglig.' USING ERRCODE='42501'; END IF;
  RETURN previous.vehicle_id;
 END IF;
 IF jsonb_typeof(p_fields) IS DISTINCT FROM 'object' OR nullif(trim(p_fields->>'name'),'') IS NULL OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_fields) k WHERE k<>ALL(allowed)) THEN RAISE EXCEPTION 'Kontrollera tillgångens uppgifter.' USING ERRCODE='22023'; END IF;
 FOR ref IN SELECT nullif(p_fields->>k,'')::uuid FROM unnest(ARRAY['company_id']) k LOOP
  IF ref IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vihem_companies WHERE id=ref AND organisation_id=caller.organisation_id) THEN RAISE EXCEPTION 'Bolaget är inte tillgängligt.' USING ERRCODE='42501'; END IF;
 END LOOP;
 ref:=nullif(p_fields->>'property_id','')::uuid;
 IF ref IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vihem_properties WHERE id=ref AND organisation_id=caller.organisation_id) THEN RAISE EXCEPTION 'Fastigheten är inte tillgänglig.' USING ERRCODE='42501'; END IF;
 ref:=nullif(p_fields->>'responsible_user_id','')::uuid;
 IF ref IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=ref AND organisation_id=caller.organisation_id AND active AND role IN ('staff','admin','superadmin')) THEN RAISE EXCEPTION 'Ansvarig är inte tillgänglig.' USING ERRCODE='42501'; END IF;
 IF p_vehicle IS NOT NULL THEN
  SELECT * INTO target FROM public.vihem_fleet_vehicles WHERE id=p_vehicle AND organisation_id=caller.organisation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tillgången är inte tillgänglig.' USING ERRCODE='42501'; END IF;
  IF target.updated_at IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Tillgången har ändrats. Öppna den igen och jämför dina ändringar.' USING ERRCODE='P0001'; END IF;
 END IF;
 fields:=p_fields||jsonb_build_object('organisation_id',caller.organisation_id);
 IF p_vehicle IS NULL THEN fields:=fields||jsonb_build_object('created_by',caller.id); END IF;
 SELECT string_agg(format('%I',k),',' ORDER BY k) INTO cols FROM jsonb_object_keys(fields) k;
 IF p_vehicle IS NULL THEN
  EXECUTE format('INSERT INTO public.vihem_fleet_vehicles(%s) SELECT %s FROM jsonb_populate_record(NULL::public.vihem_fleet_vehicles,$1) RETURNING id',cols,cols) INTO v_result USING fields;
 ELSE
  EXECUTE format('UPDATE public.vihem_fleet_vehicles SET (%s)=(SELECT %s FROM jsonb_populate_record(NULL::public.vihem_fleet_vehicles,$1)) WHERE id=$2 RETURNING id',cols,cols) INTO v_result USING fields,p_vehicle;
 END IF;
 IF p_vehicle IS NULL OR (p_fields ? 'status' AND target.status IS DISTINCT FROM p_fields->>'status') THEN
  INSERT INTO public.vihem_fleet_events(organisation_id,vehicle_id,event_type,summary,actor_id)
  VALUES(caller.organisation_id,v_result,CASE WHEN p_vehicle IS NULL THEN 'created' ELSE 'status_changed' END,CASE WHEN p_vehicle IS NULL THEN 'Tillgång skapad' ELSE 'Status ändrad: '||(CASE target.status WHEN 'in_service' THEN 'I drift' WHEN 'workshop' THEN 'På verkstad' WHEN 'out_of_service' THEN 'Ur drift' WHEN 'driving_ban' THEN 'Körförbud' WHEN 'laid_up' THEN 'Avställd' WHEN 'rented_out' THEN 'Uthyrd' WHEN 'sold' THEN 'Såld' ELSE target.status END)||' → '||(CASE (p_fields->>'status') WHEN 'in_service' THEN 'I drift' WHEN 'workshop' THEN 'På verkstad' WHEN 'out_of_service' THEN 'Ur drift' WHEN 'driving_ban' THEN 'Körförbud' WHEN 'laid_up' THEN 'Avställd' WHEN 'rented_out' THEN 'Uthyrd' WHEN 'sold' THEN 'Såld' ELSE (p_fields->>'status') END) END,caller.id);
 END IF;
 IF p_inspection IS NOT NULL THEN
  IF jsonb_typeof(p_inspection) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_inspection) k WHERE k NOT IN ('last_inspection_date','next_inspection_date')) THEN RAISE EXCEPTION 'Kontrolluppgifterna är ogiltiga.'; END IF;
  SELECT id INTO inspection_id FROM public.vihem_fleet_inspections WHERE vehicle_id=v_result AND inspection_type='Kontrollbesiktning' ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF FOUND THEN UPDATE public.vihem_fleet_inspections SET last_inspection_date=(p_inspection->>'last_inspection_date')::date,next_inspection_date=(p_inspection->>'next_inspection_date')::date WHERE id=inspection_id;
  ELSE INSERT INTO public.vihem_fleet_inspections(organisation_id,vehicle_id,inspection_type,last_inspection_date,next_inspection_date,created_by) VALUES(caller.organisation_id,v_result,'Kontrollbesiktning',(p_inspection->>'last_inspection_date')::date,(p_inspection->>'next_inspection_date')::date,caller.id); END IF;
 END IF;
 IF p_source IS NOT NULL THEN
  IF jsonb_typeof(p_source) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_source) k WHERE k NOT IN ('url','extracted','last_inspection_date','next_inspection_date')) OR coalesce(p_source->>'url','') !~ '^https?://' THEN RAISE EXCEPTION 'Källuppgifterna är ogiltiga.'; END IF;
  INSERT INTO public.vihem_fleet_vehicle_sources(organisation_id,vehicle_id,url,extracted,last_inspection_date,next_inspection_date,last_checked_at,last_status,created_by)
  VALUES(caller.organisation_id,v_result,p_source->>'url',p_source->'extracted',(p_source->>'last_inspection_date')::date,(p_source->>'next_inspection_date')::date,now(),'ok',caller.id)
  ON CONFLICT(vehicle_id,url) DO UPDATE SET extracted=excluded.extracted,last_inspection_date=excluded.last_inspection_date,next_inspection_date=excluded.next_inspection_date,last_checked_at=excluded.last_checked_at,last_status='ok';
 END IF;
 INSERT INTO public.vihem_fleet_save_operations(actor_id,operation_id,vehicle_id,request_hash) VALUES(caller.id,p_operation,v_result,fingerprint);
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.vihem_save_fleet_editor(uuid,uuid,timestamptz,jsonb,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vihem_save_fleet_editor(uuid,uuid,timestamptz,jsonb,jsonb,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
