BEGIN;
-- Existing snow clients are assignments, not a second legal-customer register.
ALTER TABLE public.vihem_snow_clients ADD COLUMN finance_customer_id uuid REFERENCES public.vihem_finance_customers(id), ADD COLUMN company_id uuid REFERENCES public.vihem_companies(id), ADD COLUMN invoice_reference text NOT NULL DEFAULT '', ADD COLUMN cost_center text NOT NULL DEFAULT '', ADD COLUMN instructions text NOT NULL DEFAULT '';
CREATE TABLE public.vihem_snow_settings(organisation_id uuid PRIMARY KEY REFERENCES public.vihem_organisations(id),settings jsonb NOT NULL DEFAULT '{}',revision int NOT NULL DEFAULT 1);
CREATE TABLE public.vihem_snow_resources(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id),vehicle_id uuid REFERENCES public.vihem_fleet_vehicles(id),name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 150),method text NOT NULL DEFAULT 'machine' CHECK(method IN ('machine','hand')),active boolean NOT NULL DEFAULT true,UNIQUE(id,organisation_id),UNIQUE(organisation_id,vehicle_id));
CREATE TABLE public.vihem_snow_competencies(organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id),user_id uuid NOT NULL REFERENCES public.vihem_profiles(id),resource_id uuid NOT NULL,active boolean NOT NULL DEFAULT true,PRIMARY KEY(user_id,resource_id),FOREIGN KEY(resource_id,organisation_id) REFERENCES public.vihem_snow_resources(id,organisation_id));
CREATE TABLE public.vihem_snow_patterns(organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id),user_id uuid NOT NULL REFERENCES public.vihem_profiles(id),weekday int NOT NULL CHECK(weekday BETWEEN 1 AND 7),slots jsonb NOT NULL DEFAULT '[]',updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(organisation_id,user_id,weekday));
CREATE TABLE public.vihem_snow_week_confirmations(organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id),user_id uuid NOT NULL REFERENCES public.vihem_profiles(id),week_start date NOT NULL CHECK(extract(isodow FROM week_start)=1),available boolean NOT NULL,confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(organisation_id,user_id,week_start));
CREATE TABLE public.vihem_snow_duties(id uuid PRIMARY KEY,organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id),client_id uuid NOT NULL,resource_id uuid NOT NULL,starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,planned_user uuid REFERENCES public.vihem_profiles(id),accepted_user uuid REFERENCES public.vihem_profiles(id),state text NOT NULL DEFAULT 'planned' CHECK(state IN ('planned','calling','accepted','working','done','cancelled')),activity text NOT NULL CHECK(activity IN ('snow_plowing','snow_sanding')),message text NOT NULL DEFAULT '',relief_of uuid REFERENCES public.vihem_snow_duties(id),created_by uuid NOT NULL REFERENCES public.vihem_profiles(id),revision int NOT NULL DEFAULT 1,UNIQUE(id,organisation_id),FOREIGN KEY(client_id,organisation_id) REFERENCES public.vihem_snow_clients(id,organisation_id),FOREIGN KEY(resource_id,organisation_id) REFERENCES public.vihem_snow_resources(id,organisation_id),CHECK(isfinite(starts_at) AND isfinite(ends_at) AND ends_at>starts_at AND ends_at<=starts_at+interval '24 hours'));
CREATE INDEX snow_duty_dates ON public.vihem_snow_duties(organisation_id,starts_at,ends_at);
CREATE TABLE public.vihem_snow_invitations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid NOT NULL, duty_id uuid NOT NULL,user_id uuid NOT NULL REFERENCES public.vihem_profiles(id),state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','declined','expired','superseded')),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL,reminded boolean NOT NULL DEFAULT false,responded_at timestamptz,UNIQUE(duty_id,user_id),FOREIGN KEY(duty_id,organisation_id) REFERENCES public.vihem_snow_duties(id,organisation_id));
CREATE UNIQUE INDEX snow_single_accepted_invite ON public.vihem_snow_invitations(duty_id) WHERE state='accepted';
CREATE TABLE public.vihem_snow_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id),actor_id uuid REFERENCES public.vihem_profiles(id),kind text NOT NULL,object_id uuid,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.vihem_snow_operations(id uuid PRIMARY KEY,organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id),actor_id uuid NOT NULL REFERENCES public.vihem_profiles(id),action text NOT NULL,request jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.vihem_snow_notices(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id),user_id uuid NOT NULL REFERENCES public.vihem_profiles(id),dedupe text NOT NULL,kind text NOT NULL,object_id uuid,title text NOT NULL,message text NOT NULL,notification_id uuid REFERENCES public.vihem_notifications(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(organisation_id,dedupe));
ALTER TABLE public.vihem_time_entries ADD COLUMN snow_resource_id uuid REFERENCES public.vihem_snow_resources(id),ADD COLUMN snow_duty_id uuid REFERENCES public.vihem_snow_duties(id),ADD COLUMN snow_review_flags text[] NOT NULL DEFAULT '{}';
CREATE TABLE public.vihem_snow_time_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,organisation_id uuid NOT NULL,entry_id uuid NOT NULL REFERENCES public.vihem_time_entries(id),actor_id uuid,reason text NOT NULL,before_data jsonb,created_at timestamptz NOT NULL DEFAULT clock_timestamp());

CREATE FUNCTION public.vihem_snow_config(p_org uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT '{"max_hours":12,"rest_hours":11,"response_minutes":5,"remind_minutes":2,"weekly_day":7,"weekly_hour":12,"auto_approve":true}'::jsonb||coalesce((SELECT settings FROM vihem_snow_settings WHERE organisation_id=p_org),'{}')
$$;
CREATE FUNCTION public.vihem_snow_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$SELECT vihem_snow_access() AND vihem_get_my_role() IN ('admin','superadmin')$$;
CREATE FUNCTION public.vihem_snow_worker(p_user uuid,p_org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM vihem_profiles p JOIN vihem_organisation_modules m ON m.organisation_id=p.organisation_id AND m.module_key='snow' AND m.enabled WHERE p.id=p_user AND p.organisation_id=p_org AND p.active AND (p.role IN ('admin','superadmin') OR (coalesce((m.settings->>'admin_only')::boolean,true)=false AND ((p.role='staff' AND vihem_has_permission(p.id,'module.snow')) OR (p.role='snow' AND p.snow_time_access)))))
$$;
CREATE FUNCTION public.vihem_snow_valid_slots(p_slots jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE x jsonb;last_end int:=-1;a int;b int;BEGIN
 IF jsonb_typeof(p_slots) IS DISTINCT FROM 'array' OR jsonb_array_length(p_slots)>4 THEN RETURN false;END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_slots) LOOP
 IF jsonb_typeof(x)<>'array' OR jsonb_array_length(x)<>2 OR (x->>0)::numeric<>trunc((x->>0)::numeric) OR (x->>1)::numeric<>trunc((x->>1)::numeric) THEN RETURN false;END IF;
 a:=(x->>0)::int;b:=(x->>1)::int;IF a<0 OR b>1440 OR a>=b OR a<last_end THEN RETURN false;END IF;last_end:=b;END LOOP;RETURN true;
 EXCEPTION WHEN others THEN RETURN false;END$$;
ALTER TABLE public.vihem_snow_patterns ADD CONSTRAINT snow_pattern_slots CHECK(public.vihem_snow_valid_slots(slots));
-- Availability is an offer to work, never an accepted duty.
CREATE FUNCTION public.vihem_snow_available(p_org uuid,p_user uuid,p_start timestamptz,p_end timestamptz,p_confirmed boolean DEFAULT true) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d date;last_d date;w date;c vihem_snow_week_confirmations;s jsonb;a int;b int;BEGIN
 IF p_start IS NULL OR p_end IS NULL OR NOT isfinite(p_start) OR NOT isfinite(p_end) OR NOT vihem_snow_worker(p_user,p_org) OR p_end<=p_start OR p_end>p_start+interval '24 hours' THEN RETURN false;END IF;
 d:=(p_start AT TIME ZONE 'Europe/Stockholm')::date;last_d:=((p_end-interval '1 microsecond') AT TIME ZONE 'Europe/Stockholm')::date;
 WHILE d<=last_d LOOP
  w:=d-(extract(isodow FROM d)::int-1);
  SELECT * INTO c FROM vihem_snow_week_confirmations WHERE organisation_id=p_org AND user_id=p_user AND week_start=w;
  IF c.user_id IS NOT NULL AND NOT c.available THEN RETURN false;END IF;
  IF p_confirmed AND (c.user_id IS NULL OR EXISTS(SELECT 1 FROM vihem_snow_patterns WHERE organisation_id=p_org AND user_id=p_user AND updated_at>c.confirmed_at) OR EXISTS(SELECT 1 FROM vihem_snow_availability WHERE organisation_id=p_org AND user_id=p_user AND work_date BETWEEN w AND w+6 AND updated_at>c.confirmed_at)) THEN RETURN false;END IF;
  IF EXISTS(SELECT 1 FROM vihem_staff_absence_requests WHERE organisation_id=p_org AND user_id=p_user AND status='approved' AND d BETWEEN start_date AND end_date) THEN RETURN false;END IF;
  SELECT slots INTO s FROM vihem_snow_availability WHERE organisation_id=p_org AND user_id=p_user AND work_date=d;
  IF NOT FOUND THEN SELECT slots INTO s FROM vihem_snow_patterns WHERE organisation_id=p_org AND user_id=p_user AND weekday=extract(isodow FROM d);END IF;
  a:=CASE WHEN d=(p_start AT TIME ZONE 'Europe/Stockholm')::date THEN extract(hour FROM p_start AT TIME ZONE 'Europe/Stockholm')::int*60+extract(minute FROM p_start AT TIME ZONE 'Europe/Stockholm')::int ELSE 0 END;
  b:=CASE WHEN d=last_d THEN CASE WHEN p_end=(d+1)::timestamp AT TIME ZONE 'Europe/Stockholm' THEN 1440 ELSE ceil(extract(epoch FROM ((p_end AT TIME ZONE 'Europe/Stockholm')-d::timestamp))/60)::int END ELSE 1440 END;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(s,'[]')) x WHERE (x->>0)::int<=a AND (x->>1)::int>=b) THEN RETURN false;END IF;
  d:=d+1;
 END LOOP;RETURN true;
END$$;
CREATE FUNCTION public.vihem_snow_candidate(p_org uuid,p_user uuid,p_resource uuid,p_start timestamptz,p_end timestamptz,p_ignore uuid DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT vihem_snow_available(p_org,p_user,p_start,p_end) AND EXISTS(SELECT 1 FROM vihem_snow_resources WHERE id=p_resource AND organisation_id=p_org AND active) AND EXISTS(SELECT 1 FROM vihem_snow_competencies WHERE organisation_id=p_org AND resource_id=p_resource AND user_id=p_user AND active)
 AND extract(epoch FROM p_end-p_start)/3600<=(vihem_snow_config(p_org)->>'max_hours')::numeric
 AND NOT EXISTS(SELECT 1 FROM vihem_snow_duties WHERE organisation_id=p_org AND id IS DISTINCT FROM p_ignore AND state NOT IN ('done','cancelled') AND (accepted_user=p_user OR planned_user=p_user) AND tstzrange(starts_at,ends_at,'[)') && tstzrange(p_start-make_interval(hours=>(vihem_snow_config(p_org)->>'rest_hours')::int),p_end+make_interval(hours=>(vihem_snow_config(p_org)->>'rest_hours')::int),'[)'))
 AND NOT EXISTS(SELECT 1 FROM vihem_time_entries WHERE organisation_id=p_org AND user_id=p_user AND entry_type='work' AND end_time IS NULL)
 AND NOT EXISTS(SELECT 1 FROM vihem_time_entries WHERE organisation_id=p_org AND user_id=p_user AND entry_type='work' AND end_time IS NOT NULL AND start_time<p_end AND end_time>p_start-make_interval(hours=>(vihem_snow_config(p_org)->>'rest_hours')::int))
$$;
-- No direct client writes. Admins can inspect all planning; drivers only their own planning/requests.
DO $$DECLARE t text;pred text;BEGIN
 FOREACH t IN ARRAY ARRAY['vihem_snow_settings','vihem_snow_resources','vihem_snow_competencies','vihem_snow_patterns','vihem_snow_week_confirmations','vihem_snow_duties','vihem_snow_invitations','vihem_snow_events','vihem_snow_operations','vihem_snow_notices','vihem_snow_time_audit'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  pred:=CASE WHEN t IN ('vihem_snow_resources') THEN 'true' WHEN t IN ('vihem_snow_competencies','vihem_snow_patterns','vihem_snow_week_confirmations','vihem_snow_invitations') THEN 'user_id=auth.uid()' WHEN t='vihem_snow_duties' THEN 'planned_user=auth.uid() OR accepted_user=auth.uid() OR EXISTS(SELECT 1 FROM vihem_snow_invitations i WHERE i.duty_id=vihem_snow_duties.id AND i.user_id=auth.uid())' ELSE 'false' END;
  EXECUTE format('CREATE POLICY snow_v2_read ON public.%I FOR SELECT TO authenticated USING(organisation_id=vihem_get_my_org_id() AND vihem_snow_access() AND (vihem_snow_admin() OR (%s)))',t,pred);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
END$$;
-- Cross-org and double-booking invariants also apply to service writes.
CREATE FUNCTION public.vihem_snow_duty_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE who uuid;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('snow-availability:'||NEW.organisation_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM vihem_snow_clients WHERE id=NEW.client_id AND organisation_id=NEW.organisation_id) OR NOT EXISTS(SELECT 1 FROM vihem_snow_resources WHERE id=NEW.resource_id AND organisation_id=NEW.organisation_id) THEN RAISE EXCEPTION 'Uppdrag eller maskin tillhör annan organisation' USING ERRCODE='42501';END IF;
 FOREACH who IN ARRAY ARRAY[NEW.planned_user,NEW.accepted_user] LOOP
  IF who IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vihem_profiles WHERE id=who AND organisation_id=NEW.organisation_id AND active) THEN RAISE EXCEPTION 'Ogiltig förare' USING ERRCODE='42501';END IF;
 END LOOP;
 IF NEW.state<>'cancelled' AND EXISTS(SELECT 1 FROM vihem_snow_duties d WHERE d.organisation_id=NEW.organisation_id AND d.id<>NEW.id AND d.state<>'cancelled' AND tstzrange(d.starts_at,d.ends_at,'[)')&&tstzrange(NEW.starts_at,NEW.ends_at,'[)') AND (d.resource_id=NEW.resource_id OR coalesce(d.accepted_user,d.planned_user)=coalesce(NEW.accepted_user,NEW.planned_user))) THEN RAISE EXCEPTION 'Maskinen eller föraren är redan bokad' USING ERRCODE='23505';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER snow_duty_guard BEFORE INSERT OR UPDATE ON public.vihem_snow_duties FOR EACH ROW EXECUTE FUNCTION public.vihem_snow_duty_guard();
CREATE FUNCTION public.vihem_snow_notice(p_org uuid,p_user uuid,p_key text,p_kind text,p_object uuid,p_title text,p_message text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 INSERT INTO vihem_snow_notices(organisation_id,user_id,dedupe,kind,object_id,title,message) VALUES(p_org,p_user,p_key,p_kind,p_object,p_title,p_message) ON CONFLICT DO NOTHING
$$;
-- Full RPC functions live in the next migration. Internal helpers are never client callable.
DO $$DECLARE f record;BEGIN FOR f IN SELECT oid::regprocedure sig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('vihem_snow_config','vihem_snow_worker','vihem_snow_valid_slots','vihem_snow_available','vihem_snow_candidate','vihem_snow_duty_guard','vihem_snow_notice') LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,authenticated,anon',f.sig);END LOOP;END$$;
GRANT EXECUTE ON FUNCTION public.vihem_snow_admin() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
