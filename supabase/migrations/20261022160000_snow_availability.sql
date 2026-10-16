BEGIN;
-- Keep the first release inside the existing admin pilot.
UPDATE public.vihem_module_registry SET default_settings=coalesce(default_settings,'{}'::jsonb)||'{"staff_availability_enabled":false}'::jsonb WHERE module_key='snow';
UPDATE public.vihem_organisation_modules SET settings=coalesce(settings,'{}'::jsonb)||'{"staff_availability_enabled":false}'::jsonb WHERE module_key='snow';
CREATE TABLE public.vihem_snow_availability(
 organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id),user_id uuid NOT NULL REFERENCES public.vihem_profiles(id),work_date date NOT NULL,
 status text NOT NULL CHECK(status IN ('available','partial','unavailable','unknown')),
 slots jsonb NOT NULL DEFAULT '[]',revision integer NOT NULL DEFAULT 1 CHECK(revision>0),updated_by uuid NOT NULL REFERENCES public.vihem_profiles(id),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organisation_id,user_id,work_date)
);
CREATE TABLE public.vihem_snow_availability_operations(
 id uuid PRIMARY KEY,organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id),actor_id uuid NOT NULL REFERENCES public.vihem_profiles(id),request jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.vihem_snow_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_snow_availability_operations ENABLE ROW LEVEL SECURITY;
-- No direct writes or profile reads: the API returns only names and planning data.
CREATE OR REPLACE FUNCTION public.vihem_snow_availability_access() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.vihem_profiles p WHERE p.id=auth.uid() AND p.active AND p.role IN ('admin','superadmin','staff') AND public.vihem_module_enabled('snow') AND
 (p.role IN ('admin','superadmin') OR EXISTS(SELECT 1 FROM public.vihem_organisation_modules m WHERE m.organisation_id=p.organisation_id AND m.module_key='snow' AND m.enabled AND coalesce((m.settings->>'staff_availability_enabled')::boolean,false))))
$$;
CREATE POLICY availability_read ON public.vihem_snow_availability FOR SELECT TO authenticated USING(organisation_id=public.vihem_get_my_org_id() AND public.vihem_snow_availability_access());
CREATE OR REPLACE FUNCTION public.vihem_snow_availability_snapshot(p_from date,p_days integer DEFAULT 7) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE org uuid:=public.vihem_get_my_org_id();last_day date;BEGIN
 IF NOT public.vihem_snow_availability_access() THEN RAISE EXCEPTION 'Tillgänglighet för snö är inte öppnad för ditt konto' USING ERRCODE='42501';END IF;
 IF p_from IS NULL OR NOT isfinite(p_from) OR p_days IS NULL OR p_days NOT BETWEEN 1 AND 31 THEN RAISE EXCEPTION 'Välj högst 31 dagar';END IF;
 last_day:=p_from+p_days-1;
 RETURN jsonb_build_object(
 'people',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name) ORDER BY p.name),'[]'::jsonb) FROM public.vihem_profiles p WHERE p.organisation_id=org AND p.active AND p.role IN ('staff','admin','superadmin','snow')),
 'days',(SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) FROM public.vihem_snow_availability a WHERE a.organisation_id=org AND a.work_date BETWEEN p_from AND last_day),
 'shifts',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'user_id',s.user_id,'starts_at',s.starts_at,'ends_at',s.ends_at)),'[]'::jsonb) FROM public.vihem_jour_shifts s WHERE s.organisation_id=org AND s.duty_type='sno' AND s.starts_at<((last_day+1)::timestamp AT TIME ZONE 'Europe/Stockholm') AND s.ends_at>(p_from::timestamp AT TIME ZONE 'Europe/Stockholm')),
 'absences',(SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',a.user_id,'start_date',a.start_date,'end_date',a.end_date)),'[]'::jsonb) FROM public.vihem_staff_absence_requests a WHERE a.organisation_id=org AND a.status='approved' AND a.start_date<=last_day AND a.end_date>=p_from));
END$$;
CREATE OR REPLACE FUNCTION public.vihem_snow_availability_save(p_operation uuid,p_user uuid,p_days date[],p_status text,p_slots jsonb,p_expected jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor public.vihem_profiles;target public.vihem_profiles;receipt public.vihem_snow_availability_operations;request jsonb;result jsonb;d date;row public.vihem_snow_availability;slot jsonb;start_min integer;end_min integer;previous_end integer:=-1;normalized jsonb:='[]';BEGIN
 IF NOT public.vihem_snow_availability_access() THEN RAISE EXCEPTION 'Tillgänglighet för snö är inte öppnad för ditt konto' USING ERRCODE='42501';END IF;
 SELECT * INTO actor FROM public.vihem_profiles WHERE id=auth.uid();
 SELECT * INTO target FROM public.vihem_profiles WHERE id=p_user AND organisation_id=actor.organisation_id AND active AND role IN ('staff','admin','superadmin','snow');
 IF target.id IS NULL OR (actor.role='staff' AND target.id<>actor.id) THEN RAISE EXCEPTION 'Du får bara registrera din egen tillgänglighet' USING ERRCODE='42501';END IF;
 IF p_operation IS NULL OR p_days IS NULL OR cardinality(p_days) NOT BETWEEN 1 AND 31 OR EXISTS(SELECT 1 FROM unnest(p_days) x WHERE x IS NULL OR NOT isfinite(x)) OR p_status IS NULL OR p_status NOT IN ('available','partial','unavailable','unknown') OR jsonb_typeof(p_expected) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Kontrollera datum och status';END IF;
 IF p_status='available' THEN normalized:='[[0,1440]]';
 ELSIF p_status='partial' THEN
  IF jsonb_typeof(p_slots) IS DISTINCT FROM 'array' OR jsonb_array_length(p_slots) NOT BETWEEN 1 AND 4 THEN RAISE EXCEPTION 'Ange 1–4 tidsintervall';END IF;
  FOR slot IN SELECT value FROM jsonb_array_elements(p_slots) ORDER BY (value->>0)::numeric LOOP
   IF jsonb_typeof(slot) IS DISTINCT FROM 'array' OR jsonb_array_length(slot)<>2 OR jsonb_typeof(slot->0)<>'number' OR jsonb_typeof(slot->1)<>'number' OR (slot->>0)::numeric<>trunc((slot->>0)::numeric) OR (slot->>1)::numeric<>trunc((slot->>1)::numeric) THEN RAISE EXCEPTION 'Ogiltigt tidsintervall';END IF;
   start_min:=(slot->>0)::integer;end_min:=(slot->>1)::integer;
   IF start_min<0 OR end_min>1440 OR start_min>=end_min OR start_min<previous_end THEN RAISE EXCEPTION 'Tider ska ligga mellan 00:00 och 24:00 och får inte överlappa';END IF;
   normalized:=normalized||jsonb_build_array(jsonb_build_array(start_min,end_min));previous_end:=end_min;
  END LOOP;
 END IF;
 request:=jsonb_build_object('user',p_user,'days',to_jsonb(p_days),'status',p_status,'slots',normalized,'expected',p_expected);
 -- One per-organisation lock makes batches, concurrent admins and receipt identities atomic.
 PERFORM pg_advisory_xact_lock(hashtextextended('snow-availability:'||actor.organisation_id::text,0));
 SELECT * INTO receipt FROM public.vihem_snow_availability_operations WHERE id=p_operation;
 IF receipt.id IS NOT NULL THEN
  IF receipt.actor_id<>actor.id OR receipt.organisation_id<>actor.organisation_id OR receipt.request IS DISTINCT FROM request THEN RAISE EXCEPTION 'Sparförsöket har ändrats' USING ERRCODE='42501';END IF;
  RETURN receipt.result;
 END IF;
 FOR d IN SELECT DISTINCT x FROM unnest(p_days) x ORDER BY x LOOP
  SELECT * INTO row FROM public.vihem_snow_availability WHERE organisation_id=actor.organisation_id AND user_id=p_user AND work_date=d FOR UPDATE;
  IF NOT(p_expected ? d::text) OR (p_expected->>d::text) IS NULL OR (p_expected->>d::text)::integer<>coalesce(row.revision,0) THEN RAISE EXCEPTION 'Tillgängligheten har ändrats. Läs in senaste uppgifterna innan du sparar igen.' USING ERRCODE='40001';END IF;
  INSERT INTO public.vihem_snow_availability(organisation_id,user_id,work_date,status,slots,updated_by) VALUES(actor.organisation_id,p_user,d,p_status,normalized,actor.id)
  ON CONFLICT(organisation_id,user_id,work_date) DO UPDATE SET status=excluded.status,slots=excluded.slots,revision=vihem_snow_availability.revision+1,updated_by=actor.id,updated_at=now();
 END LOOP;
 SELECT jsonb_agg(to_jsonb(a) ORDER BY work_date) INTO result FROM public.vihem_snow_availability a WHERE a.organisation_id=actor.organisation_id AND a.user_id=p_user AND a.work_date=ANY(p_days);
 INSERT INTO public.vihem_snow_availability_operations(id,organisation_id,actor_id,request,result) VALUES(p_operation,actor.organisation_id,actor.id,request,result);
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION public.vihem_snow_availability_access(),public.vihem_snow_availability_snapshot(date,integer),public.vihem_snow_availability_save(uuid,uuid,date[],text,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vihem_snow_availability_access(),public.vihem_snow_availability_snapshot(date,integer),public.vihem_snow_availability_save(uuid,uuid,date[],text,jsonb,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
