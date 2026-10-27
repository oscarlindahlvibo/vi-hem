BEGIN;
CREATE TABLE public.vihem_snow_reviews(entry_id uuid PRIMARY KEY REFERENCES public.vihem_time_entries(id),organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id),fingerprint text NOT NULL,state text NOT NULL CHECK(state IN ('approved','review')),flags text[] NOT NULL DEFAULT '{}',reviewed_by uuid REFERENCES public.vihem_profiles(id),reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE public.vihem_snow_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY snow_review_read ON public.vihem_snow_reviews FOR SELECT TO authenticated USING(organisation_id=vihem_get_my_org_id() AND vihem_snow_access() AND (vihem_snow_admin() OR EXISTS(SELECT 1 FROM vihem_time_entries e WHERE e.id=entry_id AND e.user_id=auth.uid())));
GRANT SELECT ON public.vihem_snow_reviews TO authenticated;
GRANT ALL ON public.vihem_snow_reviews TO service_role;
CREATE FUNCTION public.vihem_snow_time_fingerprint(e public.vihem_time_entries) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT md5(jsonb_build_array(e.user_id,e.organisation_id,e.snow_client_id,e.snow_resource_id,e.snow_route_id,e.snow_method,extract(epoch FROM e.start_time),extract(epoch FROM e.end_time),e.total_minutes,e.break_minutes,e.category,e.entry_type)::text)
$$;
CREATE FUNCTION public.vihem_snow_time_flags(e public.vihem_time_entries) RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE flags text[]:='{}';BEGIN
 IF e.snow_client_id IS NULL OR NOT EXISTS(SELECT 1 FROM vihem_snow_clients WHERE id=e.snow_client_id AND organisation_id=e.organisation_id AND active) THEN flags:=array_append(flags,'assignment_inactive');END IF;
 IF e.end_time IS NULL OR e.end_time<=e.start_time OR e.end_time>clock_timestamp()+interval '5 minutes' OR extract(epoch FROM e.end_time-e.start_time)/3600>(vihem_snow_config(e.organisation_id)->>'max_hours')::numeric OR e.total_minutes<=0 OR abs(e.total_minutes-(floor(extract(epoch FROM e.end_time-e.start_time)/60)::int-e.break_minutes))>1 THEN flags:=array_append(flags,'invalid_duration');END IF;
 IF e.snow_method NOT IN ('machine','hand') OR e.snow_method IS NULL THEN flags:=array_append(flags,'method_missing');END IF;
 IF e.snow_method='machine' AND (e.snow_resource_id IS NULL OR NOT EXISTS(SELECT 1 FROM vihem_snow_resources WHERE id=e.snow_resource_id AND organisation_id=e.organisation_id AND active)) THEN flags:=array_append(flags,'machine_missing');END IF;
 IF e.end_time<=e.start_time THEN RETURN flags;END IF;
 IF EXISTS(SELECT 1 FROM vihem_time_entries t WHERE (t.end_time IS NULL OR t.end_time>=t.start_time) AND t.user_id=e.user_id AND t.id<>e.id AND t.entry_type='work' AND tstzrange(t.start_time,coalesce(t.end_time,'infinity'),'[)')&&tstzrange(e.start_time,e.end_time,'[)')) THEN flags:=array_append(flags,'overlap');END IF;
 RETURN flags;
END$$;
CREATE FUNCTION public.vihem_snow_review_time(p_entry uuid,p_manual boolean DEFAULT false,p_reason text DEFAULT '') RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e vihem_time_entries;flags text[];approved boolean;BEGIN
 SELECT * INTO e FROM vihem_time_entries WHERE id=p_entry AND snow_client_id IS NOT NULL AND entry_type='work' AND end_time IS NOT NULL FOR UPDATE;
 IF NOT FOUND THEN IF p_manual THEN RAISE EXCEPTION 'Avslutat snöpass saknas';END IF;RETURN;END IF;
 IF p_manual AND (NOT vihem_snow_admin() OR e.organisation_id<>vihem_get_my_org_id() OR length(btrim(p_reason))<4) THEN RAISE EXCEPTION 'Admin och granskningsorsak krävs' USING ERRCODE='42501';END IF;
 IF p_manual AND (e.end_time<=e.start_time OR e.total_minutes<=0 OR e.end_time>clock_timestamp()+interval '5 minutes') THEN RAISE EXCEPTION 'Rätta ogiltiga tider innan granskning';END IF;
 flags:=vihem_snow_time_flags(e);approved:=p_manual OR (cardinality(flags)=0 AND (vihem_snow_config(e.organisation_id)->>'auto_approve')::boolean);
 INSERT INTO vihem_snow_reviews VALUES(e.id,e.organisation_id,vihem_snow_time_fingerprint(e),CASE WHEN approved THEN 'approved' ELSE 'review' END,flags,CASE WHEN p_manual THEN auth.uid() ELSE NULL END,clock_timestamp())
 ON CONFLICT(entry_id) DO UPDATE SET fingerprint=excluded.fingerprint,state=excluded.state,flags=excluded.flags,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at;
 INSERT INTO vihem_snow_time_audit(organisation_id,entry_id,actor_id,reason,before_data) VALUES(e.organisation_id,e.id,CASE WHEN p_manual THEN auth.uid() ELSE NULL END,CASE WHEN p_manual THEN p_reason ELSE 'Servergranskning efter stämplingskvitto' END,to_jsonb(e));
 UPDATE vihem_time_entries SET status=CASE WHEN approved THEN 'approved' ELSE 'submitted' END,snow_review_flags=flags,approved_at=CASE WHEN approved THEN clock_timestamp() ELSE NULL END,approved_by=CASE WHEN p_manual THEN auth.uid() ELSE NULL END WHERE id=e.id;
 -- Price snapshot helper is installed by the billing migration. Never create an invoice here.
 IF approved AND to_regprocedure('public.vihem_snow_value_time(uuid)') IS NOT NULL THEN PERFORM vihem_snow_value_time(e.id);END IF;
END$$;
CREATE FUNCTION public.vihem_snow_clock_receipt() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$BEGIN
 PERFORM vihem_snow_review_time(nullif(NEW.result->>'closed','')::uuid);
 RETURN NEW;
END$$;
CREATE TRIGGER snow_clock_receipt AFTER INSERT ON public.vihem_clock_operations FOR EACH ROW EXECUTE FUNCTION public.vihem_snow_clock_receipt();
CREATE FUNCTION public.vihem_snow_time_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r vihem_snow_reviews;BEGIN
 IF NEW.snow_client_id IS NULL AND (TG_OP='INSERT' OR OLD.snow_client_id IS NULL) THEN RETURN NEW;END IF;
 IF NEW.snow_client_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vihem_snow_clients WHERE id=NEW.snow_client_id AND organisation_id=NEW.organisation_id) THEN RAISE EXCEPTION 'Uppdragets organisation stämmer inte' USING ERRCODE='42501';END IF;
 IF NEW.snow_resource_id IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('snow-resource:'||NEW.snow_resource_id::text,0));
  IF NOT EXISTS(SELECT 1 FROM vihem_snow_resources WHERE id=NEW.snow_resource_id AND organisation_id=NEW.organisation_id) THEN RAISE EXCEPTION 'Resursens organisation stämmer inte' USING ERRCODE='42501';END IF;
  IF NEW.end_time IS NULL AND NEW.entry_type='work' AND EXISTS(SELECT 1 FROM vihem_time_entries WHERE snow_resource_id=NEW.snow_resource_id AND id<>NEW.id AND end_time IS NULL AND entry_type='work') THEN RAISE EXCEPTION 'Maskinen används redan' USING ERRCODE='23505';END IF;
 END IF;
 IF NEW.end_time IS NOT NULL AND NEW.entry_type='work' THEN
  SELECT * INTO r FROM vihem_snow_reviews WHERE entry_id=NEW.id;
  IF r.state='approved' AND r.fingerprint=vihem_snow_time_fingerprint(NEW) THEN NEW.status:='approved';
  ELSE NEW.status:='submitted';NEW.approved_at:=NULL;NEW.approved_by:=NULL;
   IF TG_OP='UPDATE' AND OLD.end_time IS NOT NULL AND vihem_snow_time_fingerprint(OLD) IS DISTINCT FROM vihem_snow_time_fingerprint(NEW) THEN
    NEW.snow_review_flags:=ARRAY['manual_edit'];
    INSERT INTO vihem_snow_time_audit(organisation_id,entry_id,actor_id,reason,before_data) VALUES(OLD.organisation_id,OLD.id,auth.uid(),'Manuell ändring kräver ny granskning',to_jsonb(OLD));
    UPDATE vihem_snow_reviews SET state='review',flags=ARRAY['manual_edit'] WHERE entry_id=NEW.id;
   END IF;
  END IF;
 END IF;RETURN NEW;
END$$;
CREATE TRIGGER snow_time_guard BEFORE INSERT OR UPDATE ON public.vihem_time_entries FOR EACH ROW EXECUTE FUNCTION public.vihem_snow_time_guard();
-- Reuse the original atomic clock and its exact retry receipts. No parallel time system.
CREATE FUNCTION public.vihem_snow_clock(p_id uuid,p_action text,p_expected uuid,p_event timestamptz,p_job jsonb DEFAULT '{}',p_comment text DEFAULT '',p_timezone text DEFAULT 'Europe/Stockholm') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE org uuid:=vihem_get_my_org_id();r jsonb;resource uuid;d vihem_snow_duties;e vihem_time_entries;args jsonb;receipt vihem_clock_operations;BEGIN
 IF NOT vihem_snow_access() THEN RAISE EXCEPTION 'Snöåtkomst krävs' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('snow-availability:'||org::text,0));
 -- Original clock validates identity and request on a replay; do not revalidate changed availability after success.
 SELECT * INTO receipt FROM vihem_clock_operations WHERE id=p_id;
 IF FOUND THEN RETURN vihem_clock_transition(p_id,p_action,p_expected,p_event,p_job,p_comment,p_timezone);END IF;
 SELECT * INTO e FROM vihem_time_entries WHERE id=p_expected AND user_id=auth.uid() AND organisation_id=org;
 resource:=nullif(p_job->>'snow_resource_id','')::uuid;
 IF p_action IN ('resume','break','lunch') THEN resource:=e.snow_resource_id;END IF;
 IF p_action IN ('clockin','switch','resume') THEN
  IF p_job->>'category' NOT IN ('snow_plowing','snow_sanding') AND p_action<>'resume' THEN RAISE EXCEPTION 'Välj snöarbete';END IF;
  IF resource IS NOT NULL AND (NOT EXISTS(SELECT 1 FROM vihem_snow_resources WHERE id=resource AND organisation_id=org AND active) OR NOT EXISTS(SELECT 1 FROM vihem_snow_competencies WHERE organisation_id=org AND resource_id=resource AND user_id=auth.uid() AND active)) THEN RAISE EXCEPTION 'Aktiv maskinbehörighet krävs';END IF;
  IF nullif(p_job->>'snow_duty_id','') IS NOT NULL THEN
   SELECT * INTO d FROM vihem_snow_duties WHERE id=(p_job->>'snow_duty_id')::uuid AND organisation_id=org AND accepted_user=auth.uid() AND state='accepted' FOR UPDATE;
   IF d.id IS NULL OR d.resource_id IS DISTINCT FROM resource OR d.client_id IS DISTINCT FROM nullif(p_job->>'snow_client_id','')::uuid OR d.activity IS DISTINCT FROM p_job->>'category' OR p_event<d.starts_at-interval '1 hour' OR p_event>=d.ends_at THEN RAISE EXCEPTION 'Bekräftat maskinpass saknas eller starttiden är fel';END IF;
  END IF;
 END IF;
 r:=vihem_clock_transition(p_id,p_action,p_expected,p_event,p_job,p_comment,p_timezone);
 IF p_action<>'clockout' THEN
  UPDATE vihem_time_entries SET snow_resource_id=resource,snow_duty_id=coalesce(d.id,CASE WHEN p_action IN ('resume','break','lunch') THEN e.snow_duty_id END),vehicle_id=(SELECT vehicle_id FROM vihem_snow_resources WHERE id=resource) WHERE id=p_id;
  IF d.id IS NOT NULL THEN UPDATE vihem_snow_duties SET state='working',revision=revision+1 WHERE id=d.id;END IF;
 END IF;
 IF p_action IN ('clockout','switch') AND e.snow_duty_id IS NOT NULL THEN UPDATE vihem_snow_duties SET state='done',revision=revision+1 WHERE id=e.snow_duty_id AND accepted_user=auth.uid();END IF;
 RETURN r;
END$$;
DO $$DECLARE f record;BEGIN FOR f IN SELECT oid::regprocedure sig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('vihem_snow_time_fingerprint','vihem_snow_time_flags','vihem_snow_review_time','vihem_snow_clock_receipt','vihem_snow_time_guard','vihem_snow_clock') LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,authenticated,anon',f.sig);END LOOP;END$$;
GRANT EXECUTE ON FUNCTION public.vihem_snow_clock(uuid,text,uuid,timestamptz,jsonb,text,text) TO authenticated;
COMMIT;
