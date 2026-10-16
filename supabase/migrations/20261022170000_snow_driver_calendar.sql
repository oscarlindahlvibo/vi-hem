BEGIN;
-- Prepare the restricted driver's own calendar. Do not open the admin pilot,
-- enable account provisioning or change shared PostgREST configuration.
CREATE OR REPLACE FUNCTION public.vihem_snow_availability_access() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.vihem_profiles p WHERE p.id=auth.uid() AND p.active AND public.vihem_module_enabled('snow') AND
 (p.role IN ('admin','superadmin') OR (p.role='snow' AND p.snow_time_access AND public.vihem_snow_access()) OR (p.role='staff' AND EXISTS(SELECT 1 FROM public.vihem_organisation_modules m WHERE m.organisation_id=p.organisation_id AND m.module_key='snow' AND m.enabled AND coalesce((m.settings->>'staff_availability_enabled')::boolean,false)))))
$$;
CREATE POLICY snow_own_availability_gate ON public.vihem_snow_availability AS RESTRICTIVE FOR SELECT TO authenticated USING(public.vihem_get_my_role() IS DISTINCT FROM 'snow' OR user_id=auth.uid());
CREATE OR REPLACE FUNCTION public.vihem_snow_availability_snapshot(p_from date,p_days integer DEFAULT 7) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE org uuid:=public.vihem_get_my_org_id();last_day date;BEGIN
 IF NOT public.vihem_snow_availability_access() THEN RAISE EXCEPTION 'Tillgänglighet för snö är inte öppnad för ditt konto' USING ERRCODE='42501';END IF;
 IF p_from IS NULL OR NOT isfinite(p_from) OR p_days IS NULL OR p_days NOT BETWEEN 1 AND 31 THEN RAISE EXCEPTION 'Välj högst 31 dagar';END IF;
 last_day:=p_from+p_days-1;
 RETURN jsonb_build_object(
 'people',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name) ORDER BY p.name),'[]'::jsonb) FROM public.vihem_profiles p WHERE p.organisation_id=org AND p.active AND p.role IN ('staff','admin','superadmin','snow') AND (public.vihem_get_my_role()<>'snow' OR p.id=auth.uid())),
 'days',(SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) FROM public.vihem_snow_availability a WHERE a.organisation_id=org AND a.work_date BETWEEN p_from AND last_day AND (public.vihem_get_my_role()<>'snow' OR a.user_id=auth.uid())),
 'shifts',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'user_id',s.user_id,'starts_at',s.starts_at,'ends_at',s.ends_at)),'[]'::jsonb) FROM public.vihem_jour_shifts s WHERE s.organisation_id=org AND s.duty_type='sno' AND s.starts_at<((last_day+1)::timestamp AT TIME ZONE 'Europe/Stockholm') AND s.ends_at>(p_from::timestamp AT TIME ZONE 'Europe/Stockholm') AND (public.vihem_get_my_role()<>'snow' OR s.user_id=auth.uid())),
 'absences',(SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',a.user_id,'start_date',a.start_date,'end_date',a.end_date)),'[]'::jsonb) FROM public.vihem_staff_absence_requests a WHERE a.organisation_id=org AND a.status='approved' AND a.start_date<=last_day AND a.end_date>=p_from AND (public.vihem_get_my_role()<>'snow' OR a.user_id=auth.uid())));
END$$;
DO $$DECLARE f text;needle text:='actor.role=''staff'' AND target.id<>actor.id';BEGIN
 SELECT pg_get_functiondef('public.vihem_snow_availability_save(uuid,uuid,date[],text,jsonb,jsonb)'::regprocedure) INTO f;
 IF position(needle in f)=0 THEN RAISE EXCEPTION 'Unexpected availability save definition: inspect own-driver guard';END IF;
 f:=replace(f,needle,'actor.role IN (''staff'',''snow'') AND target.id<>actor.id');EXECUTE f;
 SELECT pg_get_functiondef('public.vihem_snow_api_guard()'::regprocedure) INTO f;
 needle:='IF actor.snow_time_access THEN';
 IF position(needle in f)=0 THEN RAISE EXCEPTION 'Unexpected snow API guard definition';END IF;
 f:=replace(f,needle,E'IF actor.snow_time_access THEN\n  IF method=''POST'' AND path IN (''/rpc/vihem_snow_availability_snapshot'',''/rpc/vihem_snow_availability_save'',''/rpc/vihem_snow_availability_access'') THEN RETURN;END IF;');EXECUTE f;
END$$;
NOTIFY pgrst,'reload schema';
COMMIT;
