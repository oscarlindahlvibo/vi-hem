BEGIN;
-- Existing rules and installed clients retain fixed-language behavior. No rule is enabled here.
ALTER TABLE public.vihem_guest_message_rules ADD COLUMN language_mode text NOT NULL DEFAULT 'fixed' CHECK(language_mode IN ('fixed','auto'));
CREATE FUNCTION public.vihem_save_guest_message_rule_v2(p_id uuid,p_revision integer,p_unit uuid,p_template uuid,p_channels text[],p_language text,p_event text,p_days integer,p_time time,p_enabled boolean,p_language_mode text) RETURNS public.vihem_guest_message_rules
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor public.vihem_profiles;result public.vihem_guest_message_rules;BEGIN
 IF p_language_mode IS NULL OR p_language_mode NOT IN ('fixed','auto') THEN RAISE EXCEPTION 'Ogiltigt språkval' USING ERRCODE='22023';END IF;
 SELECT * INTO actor FROM public.vihem_profiles WHERE id=auth.uid();
 IF actor.id IS NULL OR NOT actor.active OR actor.role NOT IN ('admin','superadmin') OR NOT public.is_short_stay_enabled(actor.organisation_id) THEN RAISE EXCEPTION 'Saknar behörighet' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.vihem_short_stay_message_templates t JOIN public.vihem_short_stay_units u ON u.id=t.unit_id AND u.organisation_id=t.organisation_id WHERE t.id=p_template AND t.unit_id=p_unit AND t.organisation_id=actor.organisation_id AND (NOT p_enabled OR (t.translations ? p_language AND u.beds24_enabled AND nullif(u.beds24_room_id,'') IS NOT NULL AND nullif(u.beds24_property_id,'') IS NOT NULL))) THEN RAISE EXCEPTION 'Välj en mall och ett tillgängligt språk för ett anslutet rum';END IF;
 IF p_revision=0 THEN
 INSERT INTO public.vihem_guest_message_rules(id,organisation_id,unit_id,template_id,channels,language,language_mode,event,days_offset,send_time,enabled,activated_at,updated_by)
 VALUES(p_id,actor.organisation_id,p_unit,p_template,p_channels,p_language,p_language_mode,p_event,p_days,p_time,p_enabled,CASE WHEN p_enabled THEN clock_timestamp() END,actor.id) ON CONFLICT(id) DO NOTHING RETURNING * INTO result;
 IF result.id IS NULL THEN
 SELECT * INTO result FROM public.vihem_guest_message_rules WHERE id=p_id AND organisation_id=actor.organisation_id FOR UPDATE;
 IF result.id IS NULL OR result.revision<>1 OR result.updated_by<>actor.id OR result.unit_id<>p_unit OR result.template_id<>p_template OR result.channels<>p_channels OR result.language<>p_language OR result.language_mode<>p_language_mode OR result.event<>p_event OR result.days_offset<>p_days OR result.send_time<>p_time OR result.enabled<>p_enabled THEN RAISE EXCEPTION 'Sparningen kunde inte bekräftas. Läs om reglerna.' USING ERRCODE='40001';END IF;
 END IF;
 ELSE
 UPDATE public.vihem_guest_message_rules SET last_error='',unit_id=p_unit,template_id=p_template,channels=p_channels,language=p_language,language_mode=p_language_mode,event=p_event,days_offset=p_days,send_time=p_time,enabled=p_enabled,activated_at=CASE WHEN p_enabled THEN clock_timestamp() END,updated_by=actor.id,revision=revision+1,updated_at=clock_timestamp()
 WHERE id=p_id AND organisation_id=actor.organisation_id AND revision=p_revision RETURNING * INTO result;
 IF result.id IS NULL THEN RAISE EXCEPTION 'Regeln ändrades av någon annan. Läs om innan du sparar.' USING ERRCODE='40001';END IF;
 END IF;RETURN result;
END$$;

REVOKE ALL ON FUNCTION public.vihem_save_guest_message_rule_v2(uuid,integer,uuid,uuid,text[],text,text,integer,time,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vihem_save_guest_message_rule_v2(uuid,integer,uuid,uuid,text[],text,text,integer,time,boolean,text) TO authenticated,service_role;
-- Legacy clients explicitly save fixed language, including when editing a rule created by a newer client.
DO $$DECLARE f text;BEGIN
 SELECT pg_get_functiondef('public.vihem_save_guest_message_rule(uuid,integer,uuid,uuid,text[],text,text,integer,time,boolean)'::regprocedure) INTO f;
 IF position('language=p_language,event=' in f)=0 OR position('result.language<>p_language OR' in f)=0 THEN RAISE EXCEPTION 'Unexpected automatic rule function; inspect before migration';END IF;
 f:=replace(f,'language=p_language,event=','language=p_language,language_mode=''fixed'',event=');
 f:=replace(f,'result.language<>p_language OR','result.language<>p_language OR result.language_mode<>''fixed'' OR');
 EXECUTE f;
END$$;
NOTIFY pgrst,'reload schema';
COMMIT;
