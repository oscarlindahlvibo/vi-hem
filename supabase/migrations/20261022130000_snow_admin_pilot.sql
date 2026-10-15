BEGIN;
-- Pilot is admin-only even when old module.jour grants were copied to snow.
UPDATE public.vihem_organisation_modules SET settings=coalesce(settings,'{}'::jsonb)||'{"admin_only":true}'::jsonb WHERE module_key='snow';
UPDATE public.vihem_module_registry SET default_settings=coalesce(default_settings,'{}'::jsonb)||'{"admin_only":true}'::jsonb WHERE module_key='snow';
CREATE OR REPLACE FUNCTION public.vihem_snow_access() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.vihem_profiles p WHERE p.id=auth.uid() AND p.active AND public.vihem_module_enabled('snow')
 AND (p.role IN ('admin','superadmin') OR (
 EXISTS(SELECT 1 FROM public.vihem_organisation_modules m WHERE m.organisation_id=p.organisation_id AND m.module_key='snow' AND m.enabled AND coalesce((m.settings->>'admin_only')::boolean,true)=false)
 AND ((p.role='staff' AND public.vihem_has_permission(p.id,'module.snow')) OR (p.role='snow' AND p.snow_time_access)))))
$$;
-- External account provisioning stays closed throughout the admin pilot.
CREATE OR REPLACE FUNCTION public.vihem_snow_external_ready() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT coalesce(current_setting('pgrst.db_pre_request',true),'')='public.vihem_snow_api_guard'
 AND EXISTS(SELECT 1 FROM public.vihem_organisation_modules m WHERE m.organisation_id=public.vihem_get_my_org_id() AND m.module_key='snow' AND m.enabled AND coalesce((m.settings->>'admin_only')::boolean,true)=false)
$$;
NOTIFY pgrst,'reload schema';
COMMIT;
