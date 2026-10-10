BEGIN;
-- One database transaction for the existing staff editor. No Auth account creation.
CREATE TABLE IF NOT EXISTS public.vihem_staff_save_operations (
 actor_id uuid NOT NULL REFERENCES public.vihem_profiles(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL,
 target_id uuid NOT NULL REFERENCES public.vihem_profiles(id) ON DELETE CASCADE,
 request_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,operation_id)
);
ALTER TABLE public.vihem_staff_save_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vihem_staff_save_operations FROM anon, authenticated;
GRANT ALL ON public.vihem_staff_save_operations TO service_role;
CREATE OR REPLACE FUNCTION public.vihem_save_staff_editor(p_target uuid,p_operation uuid,p_profile jsonb,p_schedule jsonb,p_grant text[],p_revoke text[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE caller public.vihem_profiles; target public.vihem_profiles; previous text;
 request jsonb := jsonb_build_object('target',p_target,'profile',p_profile,'schedule',p_schedule,'grant',p_grant,'revoke',p_revoke);
 row jsonb; new_role text; new_system boolean; day integer; seen integer[] := '{}';
 allowed text[] := ARRAY['inventory_management','customer_projects','short_stay','rental_management','year_planning','meetings','jour','fleet_management','operations','finance','skatteverket','payroll'];
BEGIN
 SELECT * INTO caller FROM public.vihem_profiles WHERE id=auth.uid();
 IF caller.id IS NULL OR NOT caller.active OR caller.role NOT IN ('admin','superadmin') OR p_operation IS NULL THEN
  RAISE EXCEPTION 'Du saknar behörighet att redigera personal.' USING ERRCODE='42501';
 END IF;
 -- Serialize admin edits, including role changes affecting the caller's authority.
 PERFORM pg_advisory_xact_lock(hashtextextended('vihem-staff-editor',0));
 SELECT * INTO caller FROM public.vihem_profiles WHERE id=auth.uid();
 IF NOT caller.active OR caller.role NOT IN ('admin','superadmin') THEN RAISE EXCEPTION 'Behörigheten har ändrats.' USING ERRCODE='42501'; END IF;
 SELECT * INTO target FROM public.vihem_profiles WHERE id=p_target FOR UPDATE;
 IF target.id IS NULL OR target.role NOT IN ('staff','admin','superadmin','screen') OR
 (caller.role <> 'superadmin' AND target.organisation_id IS DISTINCT FROM caller.organisation_id) THEN
  RAISE EXCEPTION 'Medarbetaren är inte tillgänglig.' USING ERRCODE='42501';
 END IF;
 SELECT o.request_hash INTO previous FROM public.vihem_staff_save_operations o WHERE actor_id=caller.id AND operation_id=p_operation;
 IF FOUND THEN
  IF previous IS DISTINCT FROM md5(request::text) THEN RAISE EXCEPTION 'Sparbegäran har ändrats. Öppna medarbetaren igen.' USING ERRCODE='22023'; END IF;
  RETURN p_target;
 END IF;
 new_role:=p_profile->>'role'; new_system:=(p_profile->>'is_system_admin')::boolean;
 IF new_role NOT IN ('staff','admin','superadmin','screen') OR new_role IS NULL OR new_system IS NULL OR
 nullif(trim(p_profile->>'name'),'') IS NULL OR jsonb_typeof(p_profile->'active') <> 'boolean' THEN
  RAISE EXCEPTION 'Kontrollera personaluppgifterna.' USING ERRCODE='22023';
 END IF;
 IF caller.role <> 'superadmin' AND (target.role='superadmin' OR new_role='superadmin') THEN RAISE EXCEPTION 'Endast superadmin får ändra superadministratörer.' USING ERRCODE='42501'; END IF;
 IF new_system IS DISTINCT FROM target.is_system_admin AND caller.role <> 'superadmin' AND NOT coalesce(caller.is_system_admin,false) THEN
  RAISE EXCEPTION 'Du får inte ändra systemadminbehörigheten.' USING ERRCODE='42501';
 END IF;
 IF target.organisation_id IS NULL OR jsonb_typeof(p_schedule) <> 'array' OR jsonb_array_length(p_schedule) <> 7 THEN RAISE EXCEPTION 'Kontrollera veckoschemat.' USING ERRCODE='22023'; END IF;
 IF NOT coalesce(p_grant,'{}') <@ allowed OR NOT coalesce(p_revoke,'{}') <@ allowed THEN RAISE EXCEPTION 'Okänd modulbehörighet.' USING ERRCODE='22023'; END IF;
 IF new_role <> 'staff' AND (cardinality(p_grant)>0 OR cardinality(p_revoke)>0) THEN RAISE EXCEPTION 'Modulval gäller personalrollen.' USING ERRCODE='22023'; END IF;
 UPDATE public.vihem_profiles SET name=trim(p_profile->>'name'),phone=p_profile->>'phone',role=new_role,
 active=(p_profile->>'active')::boolean,bankid_personal_number=nullif(p_profile->>'bankid_personal_number',''),is_system_admin=new_system WHERE id=p_target;
 FOR row IN SELECT value FROM jsonb_array_elements(p_schedule) LOOP
  day:=(row->>'weekday')::integer;
  IF day IS NULL OR day NOT BETWEEN 1 AND 7 OR day=ANY(seen) OR jsonb_typeof(row->'active') <> 'boolean' OR
    ((row->>'active')::boolean AND (nullif(row->>'work_start','') IS NULL OR nullif(row->>'work_end','') IS NULL OR (row->>'work_end')::time <= (row->>'work_start')::time)) THEN
   RAISE EXCEPTION 'Kontrollera arbetsschemat. Slut måste vara efter start.' USING ERRCODE='22023';
  END IF;
  seen:=array_append(seen,day);
  INSERT INTO public.vihem_staff_work_schedules(organisation_id,user_id,weekday,active,work_start,work_end,lunch_start,lunch_minutes,updated_at)
  VALUES(target.organisation_id,p_target,day,(row->>'active')::boolean,(row->>'work_start')::time,(row->>'work_end')::time,nullif(row->>'lunch_start','')::time,(row->>'lunch_minutes')::integer,now())
  ON CONFLICT(user_id,weekday) DO UPDATE SET organisation_id=excluded.organisation_id,active=excluded.active,work_start=excluded.work_start,work_end=excluded.work_end,lunch_start=excluded.lunch_start,lunch_minutes=excluded.lunch_minutes,updated_at=excluded.updated_at;
 END LOOP;
 -- Apply only the editor's diff: retain unrelated grants and concurrent additions.
 DELETE FROM public.vihem_permission_grants WHERE organisation_id=target.organisation_id AND user_id=p_target AND permission_key=ANY(ARRAY(SELECT 'module.'||k FROM unnest(p_revoke) k));
 INSERT INTO public.vihem_permission_grants(organisation_id,user_id,permission_key,granted_by)
 SELECT target.organisation_id,p_target,'module.'||k,caller.id FROM unnest(p_grant) k ON CONFLICT DO NOTHING;
 INSERT INTO public.vihem_staff_save_operations(actor_id,operation_id,target_id,request_hash) VALUES(caller.id,p_operation,p_target,md5(request::text));
 RETURN p_target;
END $$;
REVOKE ALL ON FUNCTION public.vihem_save_staff_editor(uuid,uuid,jsonb,jsonb,text[],text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vihem_save_staff_editor(uuid,uuid,jsonb,jsonb,text[],text[]) TO authenticated;
COMMIT;
