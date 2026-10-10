BEGIN;
CREATE TABLE IF NOT EXISTS public.vihem_fleet_service_operations (
 actor_id uuid NOT NULL REFERENCES public.vihem_profiles(id) ON DELETE CASCADE,operation_id uuid NOT NULL,
 record_id uuid NOT NULL REFERENCES public.vihem_fleet_service_records(id) ON DELETE CASCADE,request_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor_id,operation_id)
);
ALTER TABLE public.vihem_fleet_service_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vihem_fleet_service_operations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.vihem_fleet_service_operations TO service_role;
CREATE OR REPLACE FUNCTION public.vihem_record_fleet_service(p_operation uuid,p_vehicle uuid,p_revision timestamptz,p_schedule uuid,p_schedule_revision timestamptz,p_date date,p_odometer numeric,p_performer text,p_cost numeric,p_description text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE caller public.vihem_profiles; vehicle public.vihem_fleet_vehicles; schedule public.vihem_fleet_service_schedules; previous public.vihem_fleet_service_operations; result uuid;
 fingerprint text:=md5(jsonb_build_array(p_vehicle,p_revision,p_schedule,p_schedule_revision,p_date,p_odometer,p_performer,p_cost,p_description)::text);
BEGIN
 SELECT * INTO caller FROM public.vihem_profiles WHERE id=auth.uid();
 IF caller.id IS NULL OR NOT caller.active OR caller.role NOT IN ('staff','admin','superadmin') OR caller.organisation_id IS NULL OR p_operation IS NULL OR NOT public.vihem_module_enabled('fleet_management') THEN RAISE EXCEPTION 'Du saknar behörighet att registrera service.' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(caller.id::text||p_operation::text,0));
 SELECT * INTO previous FROM public.vihem_fleet_service_operations WHERE actor_id=caller.id AND operation_id=p_operation;
 IF FOUND THEN
  IF previous.request_hash IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'Registreringen har ändrats.' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.vihem_fleet_service_records WHERE id=previous.record_id AND organisation_id=caller.organisation_id) THEN RAISE EXCEPTION 'Registreringen är inte tillgänglig.' USING ERRCODE='42501'; END IF;
  RETURN previous.record_id;
 END IF;
 SELECT * INTO vehicle FROM public.vihem_fleet_vehicles WHERE id=p_vehicle AND organisation_id=caller.organisation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Tillgången är inte tillgänglig.' USING ERRCODE='42501'; END IF;
 IF vehicle.updated_at IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Tillgången har ändrats. Öppna den igen.' USING ERRCODE='P0001'; END IF;
 IF p_date IS NULL OR (p_odometer IS NOT NULL AND (p_odometer<0 OR p_odometer::text IN ('NaN','Infinity','-Infinity'))) OR (p_cost IS NOT NULL AND (p_cost<0 OR p_cost::text IN ('NaN','Infinity','-Infinity'))) THEN RAISE EXCEPTION 'Kontrollera datum, mätarställning och kostnad.' USING ERRCODE='22023'; END IF;
 IF caller.role='staff' AND (p_cost IS NOT NULL OR p_odometer>vehicle.current_odometer) THEN RAISE EXCEPTION 'Kostnader och ändrad aktuell mätarställning registreras av administratör.' USING ERRCODE='42501'; END IF;
 IF p_schedule IS NOT NULL THEN
  SELECT * INTO schedule FROM public.vihem_fleet_service_schedules WHERE id=p_schedule AND vehicle_id=p_vehicle AND organisation_id=caller.organisation_id AND active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Serviceplanen är inte tillgänglig.' USING ERRCODE='42501'; END IF;
  IF schedule.updated_at IS DISTINCT FROM p_schedule_revision THEN RAISE EXCEPTION 'Serviceplanen har ändrats. Öppna den igen.' USING ERRCODE='P0001'; END IF;
  IF caller.role='staff' THEN RAISE EXCEPTION 'Serviceplanens uppföljning registreras av administratör.' USING ERRCODE='42501'; END IF;
 END IF;
 INSERT INTO public.vihem_fleet_service_records(organisation_id,vehicle_id,schedule_id,performed_at,odometer,performed_by_text,cost,description,created_by)
 VALUES(caller.organisation_id,p_vehicle,p_schedule,p_date,p_odometer,coalesce(btrim(p_performer),''),p_cost,coalesce(btrim(p_description),''),caller.id) RETURNING id INTO result;
 IF p_schedule IS NOT NULL THEN
  UPDATE public.vihem_fleet_service_schedules SET last_done_at=p_date,last_done_odometer=p_odometer,
   next_due_date=CASE WHEN schedule.interval_months IS NOT NULL THEN p_date + schedule.interval_months*30 ELSE NULL END,
   next_due_odometer=CASE WHEN schedule.interval_km IS NOT NULL AND p_odometer IS NOT NULL THEN p_odometer+schedule.interval_km ELSE NULL END WHERE id=p_schedule;
 END IF;
 IF caller.role IN ('admin','superadmin') AND p_odometer IS NOT NULL AND p_odometer>=vehicle.current_odometer THEN UPDATE public.vihem_fleet_vehicles SET current_odometer=p_odometer WHERE id=p_vehicle; END IF;
 IF p_cost IS NOT NULL THEN INSERT INTO public.vihem_fleet_costs(organisation_id,vehicle_id,cost_type,amount,cost_date,description,created_by) VALUES(caller.organisation_id,p_vehicle,'service',p_cost,p_date,coalesce(btrim(p_description),''),caller.id); END IF;
 INSERT INTO public.vihem_fleet_events(organisation_id,vehicle_id,event_type,summary,actor_id) VALUES(caller.organisation_id,p_vehicle,'service_recorded',coalesce(nullif(btrim(p_description),''),'Service registrerad'),caller.id);
 INSERT INTO public.vihem_fleet_service_operations(actor_id,operation_id,record_id,request_hash) VALUES(caller.id,p_operation,result,fingerprint);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.vihem_record_fleet_service(uuid,uuid,timestamptz,uuid,timestamptz,date,numeric,text,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vihem_record_fleet_service(uuid,uuid,timestamptz,uuid,timestamptz,date,numeric,text,numeric,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
