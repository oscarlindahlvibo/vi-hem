BEGIN;
CREATE TABLE public.vihem_fleet_plan_operations(actor_id uuid NOT NULL REFERENCES public.vihem_profiles(id),operation_id uuid NOT NULL,plan_id uuid NOT NULL REFERENCES public.vihem_fleet_service_schedules(id),request_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor_id,operation_id));
ALTER TABLE public.vihem_fleet_plan_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vihem_fleet_plan_operations FROM anon,authenticated;
GRANT ALL ON public.vihem_fleet_plan_operations TO service_role;
CREATE TRIGGER vihem_fleet_plan_revision BEFORE UPDATE ON public.vihem_fleet_service_schedules FOR EACH ROW EXECUTE FUNCTION public.vihem_editor_revision_timestamp();
CREATE OR REPLACE FUNCTION public.vihem_save_fleet_service_plan(p_operation uuid,p_vehicle uuid,p_plan uuid,p_expected timestamptz,p_fields jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE caller public.vihem_profiles; target public.vihem_fleet_service_schedules; previous public.vihem_fleet_plan_operations; fields public.vihem_fleet_service_schedules; result uuid;
 fingerprint text:=md5(jsonb_build_array(p_vehicle,p_plan,p_expected,p_fields)::text);
BEGIN
 SELECT * INTO caller FROM public.vihem_profiles WHERE id=auth.uid();
 IF caller.id IS NULL OR NOT caller.active OR caller.role NOT IN ('admin','superadmin') OR caller.organisation_id IS NULL OR p_operation IS NULL OR NOT public.vihem_module_enabled('fleet_management') THEN RAISE EXCEPTION 'Du saknar behörighet att ändra serviceplaner.' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(caller.id::text||p_operation::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.vihem_fleet_vehicles WHERE id=p_vehicle AND organisation_id=caller.organisation_id) THEN RAISE EXCEPTION 'Tillgången är inte tillgänglig.' USING ERRCODE='42501'; END IF;
 SELECT * INTO previous FROM public.vihem_fleet_plan_operations WHERE actor_id=caller.id AND operation_id=p_operation;
 IF FOUND THEN
  IF previous.request_hash IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'Begäran har ändrats.' USING ERRCODE='22023'; END IF;
  RETURN previous.plan_id;
 END IF;
 IF jsonb_typeof(p_fields) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_fields) k WHERE k NOT IN ('name','interval_km','interval_hours','interval_months','next_due_date','next_due_odometer','next_due_hours','notes','active')) THEN RAISE EXCEPTION 'Ogiltiga planuppgifter.' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_fields) e WHERE e.key IN ('interval_km','interval_hours','interval_months','next_due_odometer','next_due_hours') AND jsonb_typeof(e.value) NOT IN ('number','null')) THEN RAISE EXCEPTION 'Intervall och mätarvärden ska vara ändliga tal.' USING ERRCODE='22023'; END IF;
 fields:=jsonb_populate_record(NULL::public.vihem_fleet_service_schedules,p_fields);
 IF nullif(trim(fields.name),'') IS NULL OR (fields.interval_km IS NULL AND fields.interval_hours IS NULL AND fields.interval_months IS NULL) OR fields.interval_km<=0 OR fields.interval_hours<=0 OR fields.interval_months<=0 OR fields.next_due_odometer<0 OR fields.next_due_hours<0 THEN RAISE EXCEPTION 'Ange namn och minst ett positivt intervall.' USING ERRCODE='22023'; END IF;
 IF p_plan IS NULL THEN
  INSERT INTO public.vihem_fleet_service_schedules(organisation_id,vehicle_id,name,interval_km,interval_hours,interval_months,next_due_date,next_due_odometer,next_due_hours,notes,active,created_by)
  VALUES(caller.organisation_id,p_vehicle,trim(fields.name),fields.interval_km,fields.interval_hours,fields.interval_months,fields.next_due_date,fields.next_due_odometer,fields.next_due_hours,coalesce(fields.notes,''),coalesce(fields.active,true),caller.id) RETURNING id INTO result;
 ELSE
  SELECT * INTO target FROM public.vihem_fleet_service_schedules WHERE id=p_plan AND vehicle_id=p_vehicle AND organisation_id=caller.organisation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Serviceplanen är inte tillgänglig.' USING ERRCODE='42501'; END IF;
  IF target.updated_at IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Planen har ändrats av någon annan. Öppna den igen och jämför dina uppgifter.' USING ERRCODE='P0001'; END IF;
  UPDATE public.vihem_fleet_service_schedules SET name=trim(fields.name),interval_km=fields.interval_km,interval_hours=fields.interval_hours,interval_months=fields.interval_months,next_due_date=fields.next_due_date,next_due_odometer=fields.next_due_odometer,next_due_hours=fields.next_due_hours,notes=coalesce(fields.notes,''),active=coalesce(fields.active,true) WHERE id=p_plan RETURNING id INTO result;
 END IF;
 INSERT INTO public.vihem_fleet_events(organisation_id,vehicle_id,event_type,summary,actor_id) VALUES(caller.organisation_id,p_vehicle,'updated',CASE WHEN p_plan IS NULL THEN 'Serviceplan skapad: ' WHEN coalesce(fields.active,true) THEN 'Serviceplan uppdaterad: ' ELSE 'Serviceplan arkiverad: ' END||trim(fields.name),caller.id);
 INSERT INTO public.vihem_fleet_plan_operations(actor_id,operation_id,plan_id,request_hash) VALUES(caller.id,p_operation,result,fingerprint);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.vihem_save_fleet_service_plan(uuid,uuid,uuid,timestamptz,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vihem_save_fleet_service_plan(uuid,uuid,uuid,timestamptz,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
