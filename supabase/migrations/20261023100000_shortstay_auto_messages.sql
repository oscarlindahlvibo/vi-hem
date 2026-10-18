BEGIN;
CREATE TABLE public.vihem_guest_message_rules(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id),unit_id uuid NOT NULL REFERENCES public.vihem_short_stay_units(id),template_id uuid NOT NULL REFERENCES public.vihem_short_stay_message_templates(id),
 channels text[] NOT NULL DEFAULT ARRAY['booking','expedia'] CHECK(cardinality(channels) BETWEEN 1 AND 4 AND channels <@ ARRAY['booking','expedia','airbnb','vrbo']::text[]),
 language text NOT NULL DEFAULT 'en',event text NOT NULL DEFAULT 'arrival' CHECK(event IN ('arrival','departure')),days_offset integer NOT NULL DEFAULT 0 CHECK(days_offset BETWEEN -7 AND 7),send_time time NOT NULL DEFAULT '10:00',
 enabled boolean NOT NULL DEFAULT false,activated_at timestamptz,last_error text NOT NULL DEFAULT '',last_checked_at timestamptz,updated_by uuid NOT NULL REFERENCES public.vihem_profiles(id),revision integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organisation_id,template_id,event)
);
CREATE TABLE public.vihem_guest_message_jobs(
 id uuid PRIMARY KEY,organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id),rule_id uuid NOT NULL REFERENCES public.vihem_guest_message_rules(id),beds24_booking_id text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed','skipped')),note text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(rule_id,beds24_booking_id)
);
ALTER TABLE public.vihem_guest_message_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_guest_message_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vihem_guest_message_rules,public.vihem_guest_message_jobs FROM anon,authenticated;
GRANT SELECT ON public.vihem_guest_message_rules,public.vihem_guest_message_jobs TO authenticated;
GRANT ALL ON public.vihem_guest_message_rules,public.vihem_guest_message_jobs TO service_role;
CREATE POLICY org_admin_read ON public.vihem_guest_message_rules FOR SELECT TO authenticated USING(organisation_id=public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin','superadmin') AND public.is_short_stay_enabled(organisation_id) AND EXISTS(SELECT 1 FROM public.vihem_profiles p WHERE p.id=auth.uid() AND p.active));
CREATE POLICY org_admin_read ON public.vihem_guest_message_jobs FOR SELECT TO authenticated USING(organisation_id=public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin','superadmin') AND public.is_short_stay_enabled(organisation_id) AND EXISTS(SELECT 1 FROM public.vihem_profiles p WHERE p.id=auth.uid() AND p.active));
CREATE POLICY service_all ON public.vihem_guest_message_rules FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY service_all ON public.vihem_guest_message_jobs FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE FUNCTION public.vihem_save_guest_message_rule(p_id uuid,p_revision integer,p_unit uuid,p_template uuid,p_channels text[],p_language text,p_event text,p_days integer,p_time time,p_enabled boolean) RETURNS public.vihem_guest_message_rules
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor public.vihem_profiles;result public.vihem_guest_message_rules;BEGIN
 SELECT * INTO actor FROM public.vihem_profiles WHERE id=auth.uid();
 IF actor.id IS NULL OR NOT actor.active OR actor.role NOT IN ('admin','superadmin') OR NOT public.is_short_stay_enabled(actor.organisation_id) THEN RAISE EXCEPTION 'Saknar behörighet' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.vihem_short_stay_message_templates t JOIN public.vihem_short_stay_units u ON u.id=t.unit_id AND u.organisation_id=t.organisation_id WHERE t.id=p_template AND t.unit_id=p_unit AND t.organisation_id=actor.organisation_id AND t.translations ? p_language AND u.beds24_enabled AND nullif(u.beds24_room_id,'') IS NOT NULL AND nullif(u.beds24_property_id,'') IS NOT NULL) THEN RAISE EXCEPTION 'Välj en mall och ett tillgängligt språk för ett anslutet rum';END IF;
 IF p_revision=0 THEN
 INSERT INTO public.vihem_guest_message_rules(id,organisation_id,unit_id,template_id,channels,language,event,days_offset,send_time,enabled,activated_at,updated_by)
 VALUES(p_id,actor.organisation_id,p_unit,p_template,p_channels,p_language,p_event,p_days,p_time,p_enabled,CASE WHEN p_enabled THEN clock_timestamp() END,actor.id) ON CONFLICT(id) DO NOTHING RETURNING * INTO result;
 IF result.id IS NULL THEN
 SELECT * INTO result FROM public.vihem_guest_message_rules WHERE id=p_id AND organisation_id=actor.organisation_id FOR UPDATE;
 IF result.id IS NULL OR result.revision<>1 OR result.updated_by<>actor.id OR result.unit_id<>p_unit OR result.template_id<>p_template OR result.channels<>p_channels OR result.language<>p_language OR result.event<>p_event OR result.days_offset<>p_days OR result.send_time<>p_time OR result.enabled<>p_enabled THEN RAISE EXCEPTION 'Sparningen kunde inte bekräftas. Läs om reglerna.' USING ERRCODE='40001';END IF;
 END IF;
 ELSE
 UPDATE public.vihem_guest_message_rules SET last_error='',unit_id=p_unit,template_id=p_template,channels=p_channels,language=p_language,event=p_event,days_offset=p_days,send_time=p_time,enabled=p_enabled,activated_at=CASE WHEN p_enabled THEN clock_timestamp() END,updated_by=actor.id,revision=revision+1,updated_at=clock_timestamp()
 WHERE id=p_id AND organisation_id=actor.organisation_id AND revision=p_revision RETURNING * INTO result;
 IF result.id IS NULL THEN RAISE EXCEPTION 'Regeln ändrades av någon annan. Läs om innan du sparar.' USING ERRCODE='40001';END IF;
 END IF;RETURN result;
END$$;
REVOKE ALL ON FUNCTION public.vihem_save_guest_message_rule(uuid,integer,uuid,uuid,text[],text,text,integer,time,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vihem_save_guest_message_rule(uuid,integer,uuid,uuid,text[],text,text,integer,time,boolean) TO authenticated,service_role;
-- One durable claim before external POST; pending claims are never reclaimed automatically.
CREATE FUNCTION public.vihem_claim_guest_message(p_rule uuid,p_revision integer,p_booking uuid,p_message text,p_template_revision timestamptz) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.vihem_guest_message_rules;b public.vihem_short_stay_bookings;due timestamptz;job uuid:=gen_random_uuid();BEGIN
 SELECT * INTO r FROM public.vihem_guest_message_rules WHERE id=p_rule FOR UPDATE;
 IF r.id IS NULL OR NOT r.enabled OR r.revision IS DISTINCT FROM p_revision OR NOT public.is_short_stay_enabled(r.organisation_id) OR NOT EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=r.updated_by AND active AND organisation_id=r.organisation_id AND role IN ('admin','superadmin')) THEN RETURN NULL;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.vihem_short_stay_message_templates WHERE id=r.template_id AND organisation_id=r.organisation_id AND unit_id=r.unit_id AND updated_at=p_template_revision FOR SHARE) THEN RETURN NULL;END IF;
 SELECT * INTO b FROM public.vihem_short_stay_bookings WHERE id=p_booking AND organisation_id=r.organisation_id AND unit_id=r.unit_id AND booking_type='booking' FOR SHARE;
 IF b.id IS NULL OR b.beds24_booking_id IS NULL OR b.beds24_booking_id !~ '^\d+$' THEN RETURN NULL;END IF;
 due:=((CASE r.event WHEN 'arrival' THEN b.start_date ELSE b.end_date END+r.days_offset)+r.send_time) AT TIME ZONE 'Europe/Stockholm';
 IF r.activated_at IS NULL OR due<r.activated_at OR due>clock_timestamp() OR due<clock_timestamp()-interval '2 hours' THEN RETURN NULL;END IF;
 INSERT INTO public.vihem_guest_message_jobs(id,organisation_id,rule_id,beds24_booking_id) VALUES(job,r.organisation_id,r.id,b.beds24_booking_id) ON CONFLICT(rule_id,beds24_booking_id) DO NOTHING;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF EXISTS(SELECT 1 FROM public.vihem_short_stay_message_sends WHERE organisation_id=r.organisation_id AND beds24_booking_id=b.beds24_booking_id AND message=p_message AND status IN ('pending','sent')) THEN UPDATE public.vihem_guest_message_jobs SET status='skipped',note='Samma meddelande finns redan skickat eller väntande' WHERE id=job;RETURN NULL;END IF;
 INSERT INTO public.vihem_short_stay_message_sends(id,organisation_id,unit_id,beds24_booking_id,sender_id,message) VALUES(job,r.organisation_id,r.unit_id,b.beds24_booking_id,r.updated_by,p_message);
 RETURN job;
END$$;
REVOKE ALL ON FUNCTION public.vihem_claim_guest_message(uuid,integer,uuid,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vihem_claim_guest_message(uuid,integer,uuid,text,timestamptz) TO service_role;
CREATE FUNCTION public.vihem_trigger_auto_guest_messages() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,net,pg_temp AS $$
DECLARE settings jsonb;BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.vihem_guest_message_rules WHERE enabled) THEN RETURN;END IF;
 SELECT value INTO settings FROM public.vihem_system_settings WHERE key='beds24_scheduled_sync';
 IF coalesce((settings->>'enabled')::boolean,false) IS NOT TRUE OR coalesce(settings->>'secret','')='' THEN RETURN;END IF;
 PERFORM net.http_post(url:=regexp_replace(coalesce(nullif(settings->>'function_url',''),'http://kong:8000/functions/v1/vihem-sync-beds24-bookings'),'/vihem-sync-beds24-bookings$','/vihem-auto-guest-messages'),headers:=jsonb_build_object('Content-Type','application/json','x-vihem-sync-secret',settings->>'secret'),body:='{}'::jsonb,timeout_milliseconds:=120000);
END$$;
REVOKE ALL ON FUNCTION public.vihem_trigger_auto_guest_messages() FROM PUBLIC,anon,authenticated;
SELECT cron.schedule('vihem-auto-guest-messages','*/5 * * * *','SELECT public.vihem_trigger_auto_guest_messages();');
NOTIFY pgrst,'reload schema';
COMMIT;
