BEGIN;
ALTER TABLE public.vihem_profiles DROP CONSTRAINT IF EXISTS vihem_profiles_role_check;
ALTER TABLE public.vihem_profiles ADD CONSTRAINT vihem_profiles_role_check CHECK(role IN ('tenant','staff','admin','superadmin','screen','snow'));
ALTER TABLE public.vihem_profiles ADD COLUMN snow_time_access boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION public.vihem_snow_access() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.vihem_profiles p WHERE p.id=auth.uid() AND p.active AND public.vihem_module_enabled('snow')
 AND (p.role IN ('admin','superadmin') OR (p.role='staff' AND public.vihem_has_permission(p.id,'module.snow')) OR (p.role='snow' AND p.snow_time_access)))
$$;
-- Restrictive policies apply in addition to any permissive legacy policy.
-- Snow-only identities cannot read unrelated tables or mutate ordinary tables directly.
DO $$DECLARE t record;condition text;BEGIN
 FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity AND c.relname LIKE 'vihem_%' AND c.relname NOT LIKE 'vihem_snow_%' LOOP
  condition:=CASE t.relname
   WHEN 'vihem_profiles' THEN 'id=auth.uid()'
   WHEN 'vihem_time_entries' THEN 'user_id=auth.uid() AND organisation_id=public.vihem_get_my_org_id() AND snow_client_id IS NOT NULL AND public.vihem_snow_access()'
   WHEN 'vihem_clock_operations' THEN 'user_id=auth.uid() AND organisation_id=public.vihem_get_my_org_id() AND public.vihem_snow_access()'
   WHEN 'vihem_jour_shifts' THEN 'user_id=auth.uid() AND duty_type=''sno'' AND organisation_id=public.vihem_get_my_org_id() AND EXISTS(SELECT 1 FROM public.vihem_profiles p WHERE p.id=auth.uid() AND p.active)'
   WHEN 'vihem_jour_eligibility' THEN 'user_id=auth.uid() AND duty_type=''sno'' AND organisation_id=public.vihem_get_my_org_id()'
   ELSE 'false' END;
  EXECUTE format('CREATE POLICY snow_external_read_gate ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (public.vihem_get_my_role() IS DISTINCT FROM ''snow'' OR (%s))',t.relname,condition);
  EXECUTE format('CREATE POLICY snow_external_write_gate ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.vihem_get_my_role() IS DISTINCT FROM ''snow'' OR (%s)) WITH CHECK (public.vihem_get_my_role() IS DISTINCT FROM ''snow'')',t.relname,condition);
  EXECUTE format('CREATE POLICY snow_external_delete_gate ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (public.vihem_get_my_role() IS DISTINCT FROM ''snow'')',t.relname);
 END LOOP;
END$$;
CREATE POLICY snow_external_time_read ON public.vihem_time_entries FOR SELECT TO authenticated USING(user_id=auth.uid() AND public.vihem_get_my_role()='snow' AND public.vihem_snow_access());
CREATE POLICY snow_jour_read ON public.vihem_jour_shifts FOR SELECT TO authenticated USING(duty_type='sno' AND organisation_id=public.vihem_get_my_org_id() AND ((public.vihem_get_my_role()='snow' AND user_id=auth.uid()) OR public.vihem_snow_access()));
CREATE POLICY snow_eligibility_read ON public.vihem_jour_eligibility FOR SELECT TO authenticated USING(duty_type='sno' AND organisation_id=public.vihem_get_my_org_id() AND (user_id=auth.uid() OR public.vihem_snow_access()));
-- Snow administration reuses existing journey tables, even when ordinary jour is disabled.
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['vihem_jour_eligibility','vihem_jour_shifts','vihem_jour_rotation_rules'] LOOP
 EXECUTE format('CREATE POLICY snow_jour_admin ON public.%I FOR ALL TO authenticated USING(duty_type=''sno'' AND organisation_id=public.vihem_get_my_org_id() AND public.vihem_snow_access() AND public.vihem_get_my_role() IN (''admin'',''superadmin'')) WITH CHECK(duty_type=''sno'' AND organisation_id=public.vihem_get_my_org_id() AND public.vihem_snow_access() AND public.vihem_get_my_role() IN (''admin'',''superadmin''))',t);
END LOOP;END$$;
CREATE POLICY snow_offer_read ON public.vihem_jour_swap_offers FOR SELECT TO authenticated USING(organisation_id=public.vihem_get_my_org_id() AND public.vihem_snow_access() AND EXISTS(SELECT 1 FROM public.vihem_jour_shifts s WHERE s.id=shift_id AND s.duty_type='sno'));
CREATE POLICY snow_offer_insert ON public.vihem_jour_swap_offers FOR INSERT TO authenticated WITH CHECK(organisation_id=public.vihem_get_my_org_id() AND public.vihem_snow_access() AND offered_by=auth.uid() AND EXISTS(SELECT 1 FROM public.vihem_jour_shifts s WHERE s.id=shift_id AND s.duty_type='sno'));
CREATE POLICY snow_offer_update ON public.vihem_jour_swap_offers FOR UPDATE TO authenticated USING(organisation_id=public.vihem_get_my_org_id() AND public.vihem_snow_access() AND EXISTS(SELECT 1 FROM public.vihem_jour_shifts s WHERE s.id=shift_id AND s.duty_type='sno')) WITH CHECK(organisation_id=public.vihem_get_my_org_id() AND public.vihem_snow_access() AND EXISTS(SELECT 1 FROM public.vihem_jour_shifts s WHERE s.id=shift_id AND s.duty_type='sno'));
CREATE OR REPLACE FUNCTION public.vihem_snow_guard_shift_owner() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$BEGIN
 IF NEW.user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vihem_profiles p WHERE p.id=NEW.user_id AND p.organisation_id=NEW.organisation_id AND p.active AND (p.role IN ('staff','admin','superadmin') OR (p.role='snow' AND NEW.duty_type='sno'))) THEN RAISE EXCEPTION 'Välj aktiv och behörig personal i organisationen';END IF;
 RETURN NEW;END$$;
CREATE TRIGGER snow_validate_shift_owner BEFORE INSERT OR UPDATE OF user_id,organisation_id,duty_type ON public.vihem_jour_shifts FOR EACH ROW EXECUTE FUNCTION public.vihem_snow_guard_shift_owner();
-- Add the new identity to the existing clock only for validated snow operations.
DO $$DECLARE f text;BEGIN
 SELECT pg_get_functiondef('public.vihem_clock_transition(uuid,text,uuid,timestamptz,jsonb,text,text)'::regprocedure) INTO f;
 f:=replace(f,'actor.role NOT IN (''staff'',''admin'',''superadmin'')','actor.role NOT IN (''staff'',''admin'',''superadmin'',''snow'')');
 f:=replace(f,' -- All validation precedes any entry writes.',E' IF actor.role=''snow'' AND (NOT public.vihem_snow_access() OR (p_action IN (''clockin'',''switch'',''resume'') AND category_value NOT IN (''snow_plowing'',''snow_sanding'')) OR (current_entry.id IS NOT NULL AND subject.snow_client_id IS NULL)) THEN RAISE EXCEPTION ''Endast egna snöpass tillåts'' USING ERRCODE=''42501'';END IF;\n -- All validation precedes any entry writes.');
 EXECUTE f;
 SELECT pg_get_functiondef('public.vihem_clock_operation_status(uuid,uuid)'::regprocedure) INTO f;
 f:=replace(f,'role IN (''staff'',''admin'',''superadmin'')','role IN (''staff'',''admin'',''superadmin'',''snow'')');EXECUTE f;
 SELECT pg_get_functiondef('public.vihem_save_staff_editor(uuid,uuid,jsonb,jsonb,text[],text[])'::regprocedure) INTO f;
 f:=replace(f,'''staff'',''admin'',''superadmin'',''screen''','''staff'',''admin'',''superadmin'',''screen'',''snow''');
 f:=replace(f,' UPDATE public.vihem_profiles SET name=',E' IF new_role=''snow'' AND new_system THEN RAISE EXCEPTION ''Snökonton får inte vara systemadmin'';END IF;\n UPDATE public.vihem_profiles SET snow_time_access=coalesce((p_profile->>''snow_time_access'')::boolean,false),name=');
 EXECUTE f;
END$$;
-- Preserve the same personnel's access when snow moves out of ordinary jour.
INSERT INTO public.vihem_permission_grants(organisation_id,user_id,permission_key,granted_by)
SELECT organisation_id,user_id,'module.snow',granted_by FROM public.vihem_permission_grants WHERE permission_key='module.jour' ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
