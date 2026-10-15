BEGIN;
-- Installation does not alter shared PostgREST settings. Deployment must chain
-- any existing pre-request hook, then configure this guard before creating snow users.
CREATE OR REPLACE FUNCTION public.vihem_snow_api_guard() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor public.vihem_profiles%ROWTYPE; path text:=current_setting('request.path',true); method text:=current_setting('request.method',true);
BEGIN
 SELECT * INTO actor FROM public.vihem_profiles WHERE id=auth.uid();
 IF actor.role IS DISTINCT FROM 'snow' THEN RETURN;END IF;
 IF NOT actor.active OR actor.organisation_id IS NULL OR NOT public.vihem_module_enabled('snow') THEN RAISE EXCEPTION 'Snökontot är inte aktivt' USING ERRCODE='42501';END IF;
 IF method IN ('GET','HEAD') AND path IN ('/vihem_profiles','/vihem_jour_shifts') THEN RETURN;END IF;
 IF actor.snow_time_access THEN
  IF method IN ('GET','HEAD') AND path IN ('/vihem_snow_clients','/vihem_snow_routes','/vihem_snow_completions','/vihem_time_entries','/vihem_clock_operations') THEN RETURN;END IF;
  IF method='POST' AND path IN ('/rpc/vihem_clock_transition','/rpc/vihem_clock_operation_status','/rpc/vihem_snow_complete') THEN RETURN;END IF;
 END IF;
 RAISE EXCEPTION 'Snökontot har endast åtkomst till snömodulen och egna pass' USING ERRCODE='42501';
END$$;
CREATE OR REPLACE FUNCTION public.vihem_snow_external_ready() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT coalesce(current_setting('pgrst.db_pre_request',true),'')='public.vihem_snow_api_guard'
$$;
REVOKE ALL ON FUNCTION public.vihem_snow_api_guard(),public.vihem_snow_external_ready() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vihem_snow_api_guard(),public.vihem_snow_external_ready() TO authenticated,anon,service_role;
-- Role conversion through the existing staff editor has the same activation gate
-- as account creation. Refuse unexpected editor definitions rather than silently skip.
DO $$DECLARE f text;needle text:=' IF new_role=''snow'' AND new_system THEN';BEGIN
 SELECT pg_get_functiondef('public.vihem_save_staff_editor(uuid,uuid,jsonb,jsonb,text[],text[])'::regprocedure) INTO f;
 IF position(needle in f)=0 THEN RAISE EXCEPTION 'Unexpected staff editor: inspect snow activation guard before installing';END IF;
 f:=replace(f,needle,E' IF new_role=''snow'' AND NOT public.vihem_snow_external_ready() THEN RAISE EXCEPTION ''Aktivera och verifiera snökontonas API-skydd först'' USING ERRCODE=''42501'';END IF;\n'||needle);
 EXECUTE f;
END$$;
-- Prevent private storage access for the restricted identity, independent of old policies.
CREATE POLICY snow_external_storage_gate ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
USING(public.vihem_get_my_role() IS DISTINCT FROM 'snow') WITH CHECK(public.vihem_get_my_role() IS DISTINCT FROM 'snow');
NOTIFY pgrst,'reload schema';
COMMIT;
