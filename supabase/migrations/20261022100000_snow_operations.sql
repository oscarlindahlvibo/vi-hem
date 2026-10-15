BEGIN;
INSERT INTO public.vihem_module_registry(module_key,name,description,category,default_enabled,default_limits,default_settings,sort_order)
VALUES('snow','Snö & halka','Rutter, områden, snöjour och snabb stämpling.','staff',false,'{}','{}',61) ON CONFLICT(module_key) DO NOTHING;
INSERT INTO public.vihem_organisation_modules(organisation_id,module_key,enabled,limits,settings)
SELECT id,'snow',false,'{}','{}' FROM public.vihem_organisations ON CONFLICT DO NOTHING;
CREATE TABLE public.vihem_snow_clients(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 150), active boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,organisation_id)
);
CREATE UNIQUE INDEX vihem_snow_client_name ON public.vihem_snow_clients(organisation_id,lower(btrim(name)));
CREATE TABLE public.vihem_snow_routes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id),
 client_id uuid NOT NULL, name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 150),
 method text NOT NULL CHECK(method IN ('machine','hand')), priority integer NOT NULL DEFAULT 2 CHECK(priority BETWEEN 1 AND 5),
 geometry jsonb NOT NULL, instructions text NOT NULL DEFAULT '' CHECK(length(instructions)<=5000), active boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(client_id,organisation_id) REFERENCES public.vihem_snow_clients(id,organisation_id), UNIQUE(id,organisation_id)
);
ALTER TABLE public.vihem_time_entries ADD COLUMN snow_client_id uuid, ADD COLUMN snow_route_id uuid,
 ADD COLUMN snow_method text CHECK(snow_method IN ('machine','hand'));
ALTER TABLE public.vihem_time_entries ADD CONSTRAINT vihem_time_snow_client_org FOREIGN KEY(snow_client_id,organisation_id) REFERENCES public.vihem_snow_clients(id,organisation_id),
 ADD CONSTRAINT vihem_time_snow_route_org FOREIGN KEY(snow_route_id,organisation_id) REFERENCES public.vihem_snow_routes(id,organisation_id);
CREATE INDEX vihem_time_snow_history ON public.vihem_time_entries(organisation_id,start_time DESC) WHERE snow_client_id IS NOT NULL;
CREATE TABLE public.vihem_snow_completions(
 id uuid PRIMARY KEY REFERENCES public.vihem_time_entries(id), organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id),
 route_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES public.vihem_profiles(id), completed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(route_id,organisation_id) REFERENCES public.vihem_snow_routes(id,organisation_id)
);
CREATE OR REPLACE FUNCTION public.vihem_snow_access() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.vihem_profiles p WHERE p.id=auth.uid() AND p.active AND p.role IN ('staff','admin','superadmin')
 AND public.vihem_module_enabled('snow') AND (p.role IN ('admin','superadmin') OR public.vihem_has_permission(p.id,'module.snow')))
$$;
CREATE OR REPLACE FUNCTION public.vihem_snow_geometry_valid(g jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE points jsonb; p jsonb; n int;BEGIN
 IF g->>'type'='LineString' THEN points:=g->'coordinates';n:=2;
 ELSIF g->>'type'='Polygon' AND jsonb_array_length(g->'coordinates')=1 THEN points:=g->'coordinates'->0;n:=4;
 ELSE RETURN false;END IF;
 IF points IS NULL OR jsonb_typeof(points) IS DISTINCT FROM 'array' OR jsonb_array_length(points)<n OR jsonb_array_length(points)>2000 THEN RETURN false;END IF;
 IF n=4 AND points->0<>points->(jsonb_array_length(points)-1) THEN RETURN false;END IF;
 FOR p IN SELECT value FROM jsonb_array_elements(points) LOOP
  IF jsonb_typeof(p)<>'array' OR jsonb_array_length(p)<>2 OR jsonb_typeof(p->0)<>'number' OR jsonb_typeof(p->1)<>'number' OR (p->>0)::numeric NOT BETWEEN -180 AND 180 OR (p->>1)::numeric NOT BETWEEN -85 AND 85 THEN RETURN false;END IF;
 END LOOP;RETURN true;
 EXCEPTION WHEN others THEN RETURN false;END$$;
ALTER TABLE public.vihem_snow_routes ADD CONSTRAINT snow_valid_geometry CHECK(public.vihem_snow_geometry_valid(geometry));
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['vihem_snow_clients','vihem_snow_routes','vihem_snow_completions'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY snow_read ON public.%I FOR SELECT TO authenticated USING (organisation_id=public.vihem_get_my_org_id() AND public.vihem_snow_access())',t);
 EXECUTE format('CREATE POLICY snow_admin ON public.%I FOR ALL TO authenticated USING (organisation_id=public.vihem_get_my_org_id() AND public.vihem_snow_access() AND public.vihem_get_my_role() IN (''admin'',''superadmin'')) WITH CHECK (organisation_id=public.vihem_get_my_org_id() AND public.vihem_snow_access() AND public.vihem_get_my_role() IN (''admin'',''superadmin''))',t);
 EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
END LOOP;END$$;
INSERT INTO public.vihem_time_categories(organisation_id,key,label,active,sort_order,is_builtin)
SELECT o.id,k.key,k.label,true,90,true FROM public.vihem_organisations o CROSS JOIN (VALUES('snow_plowing','Snöröjning'),('snow_sanding','Sandning')) k(key,label) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.vihem_snow_save(p_kind text,p_id uuid,p_revision integer,p_data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE org uuid:=public.vihem_get_my_org_id();r jsonb;field text;BEGIN
 IF NOT public.vihem_snow_access() OR public.vihem_get_my_role() NOT IN ('admin','superadmin') THEN RAISE EXCEPTION 'Snöadministration krävs' USING ERRCODE='42501';END IF;
 IF p_id IS NULL OR p_kind NOT IN ('client','route') THEN RAISE EXCEPTION 'Ogiltig ändring';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('snow-save:'||p_id::text,0));
 IF p_revision IS NULL THEN
  IF p_kind='client' THEN SELECT to_jsonb(c) INTO r FROM public.vihem_snow_clients c WHERE id=p_id AND organisation_id=org;
  ELSE SELECT to_jsonb(c) INTO r FROM public.vihem_snow_routes c WHERE id=p_id AND organisation_id=org;END IF;
  IF r IS NOT NULL THEN
   IF (r->>'revision')::int<>1 OR NOT (r->>'active')::boolean THEN RAISE EXCEPTION 'Objektet har ändrats. Läs in senaste versionen.' USING ERRCODE='40001';END IF;
   FOR field IN SELECT unnest(CASE WHEN p_kind='client' THEN ARRAY['name'] ELSE ARRAY['name','client_id','method','priority','geometry','instructions'] END) LOOP
    IF r->field IS DISTINCT FROM (CASE WHEN field='name' THEN to_jsonb(btrim(p_data->>'name')) WHEN field='priority' THEN to_jsonb((p_data->>'priority')::int) WHEN field='instructions' THEN to_jsonb(coalesce(p_data->>'instructions','')) ELSE p_data->field END) THEN RAISE EXCEPTION 'Sparbegäran har ändrats. Läs in senaste versionen.' USING ERRCODE='40001';END IF;
   END LOOP;RETURN r;
  END IF;
 END IF;
 IF p_kind='client' THEN
  INSERT INTO public.vihem_time_categories(organisation_id,key,label,active,sort_order,is_builtin) VALUES(org,'snow_plowing','Snöröjning',true,90,true),(org,'snow_sanding','Sandning',true,91,true) ON CONFLICT DO NOTHING;
  IF p_revision IS NULL THEN INSERT INTO public.vihem_snow_clients(id,organisation_id,name) VALUES(p_id,org,btrim(p_data->>'name')) RETURNING to_jsonb(vihem_snow_clients.*) INTO r;
  ELSE UPDATE public.vihem_snow_clients SET name=btrim(p_data->>'name'),active=(p_data->>'active')::boolean,revision=revision+1 WHERE id=p_id AND organisation_id=org AND revision=p_revision RETURNING to_jsonb(vihem_snow_clients.*) INTO r;END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.vihem_snow_clients WHERE id=(p_data->>'client_id')::uuid AND organisation_id=org AND active) THEN RAISE EXCEPTION 'Välj aktiv uppdragsgivare i organisationen';END IF;
  IF p_revision IS NULL THEN INSERT INTO public.vihem_snow_routes(id,organisation_id,client_id,name,method,priority,geometry,instructions)
   VALUES(p_id,org,(p_data->>'client_id')::uuid,btrim(p_data->>'name'),p_data->>'method',(p_data->>'priority')::int,p_data->'geometry',coalesce(p_data->>'instructions','')) RETURNING to_jsonb(vihem_snow_routes.*) INTO r;
  ELSE UPDATE public.vihem_snow_routes SET client_id=(p_data->>'client_id')::uuid,name=btrim(p_data->>'name'),method=p_data->>'method',priority=(p_data->>'priority')::int,geometry=p_data->'geometry',instructions=coalesce(p_data->>'instructions',''),active=(p_data->>'active')::boolean,revision=revision+1 WHERE id=p_id AND organisation_id=org AND revision=p_revision RETURNING to_jsonb(vihem_snow_routes.*) INTO r;END IF;
 END IF;
 IF r IS NULL THEN RAISE EXCEPTION 'Ändringen har redan uppdaterats. Läs in senaste versionen.' USING ERRCODE='40001';END IF;
 RETURN r;
END$$;
CREATE OR REPLACE FUNCTION public.vihem_snow_complete(p_entry uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e public.vihem_time_entries%ROWTYPE;BEGIN
 IF NOT public.vihem_snow_access() THEN RAISE EXCEPTION 'Åtkomst nekad' USING ERRCODE='42501';END IF;
 SELECT * INTO e FROM public.vihem_time_entries WHERE id=p_entry AND user_id=auth.uid() AND organisation_id=public.vihem_get_my_org_id() AND snow_route_id IS NOT NULL FOR UPDATE;
 IF e.id IS NULL THEN RAISE EXCEPTION 'Eget ruttpass saknas';END IF;
 INSERT INTO public.vihem_snow_completions(id,organisation_id,route_id,user_id) VALUES(e.id,e.organisation_id,e.snow_route_id,e.user_id) ON CONFLICT DO NOTHING;
END$$;
REVOKE ALL ON FUNCTION public.vihem_snow_save(text,uuid,integer,jsonb),public.vihem_snow_complete(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vihem_snow_save(text,uuid,integer,jsonb),public.vihem_snow_complete(uuid) TO authenticated;
-- Preserve work-order opening comments and submitted clock-out status using the atomic transition.
CREATE OR REPLACE FUNCTION public.vihem_clock_transition(p_id uuid,p_action text,p_expected uuid,p_event timestamptz,p_job jsonb DEFAULT '{}'::jsonb,p_comment text DEFAULT '',p_timezone text DEFAULT 'Europe/Stockholm')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 actor public.vihem_profiles%ROWTYPE; current_entry public.vihem_time_entries%ROWTYPE; previous public.vihem_time_entries%ROWTYPE; next_entry public.vihem_time_entries%ROWTYPE;
 receipt public.vihem_clock_operations%ROWTYPE; args jsonb; result jsonb; job jsonb:=COALESCE(p_job,'{}'::jsonb); closing text:=btrim(COALESCE(p_comment,''));
 snow_client public.vihem_snow_clients%ROWTYPE; snow_route public.vihem_snow_routes%ROWTYPE;
 wo uuid; project uuid; change_order uuid; category_value text; scope_value text; customer text; subject public.vihem_time_entries%ROWTYPE; count_open integer; date_value date; closing_status text:=COALESCE(p_job->>'completion_status','approved'); opening text:=btrim(COALESCE(p_job->>'opening_comment',''));
BEGIN
 IF closing_status NOT IN ('approved','submitted') OR length(opening)>10000 THEN RAISE EXCEPTION 'Invalid clock metadata'; END IF;
 SELECT * INTO actor FROM public.vihem_profiles WHERE id=auth.uid() AND active;
 IF actor.id IS NULL OR actor.organisation_id IS NULL OR actor.role NOT IN ('staff','admin','superadmin') THEN RAISE EXCEPTION 'Clock access denied' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_action IS NULL OR p_action NOT IN ('clockin','clockout','switch','break','lunch','resume') OR p_event IS NULL OR NOT isfinite(p_event) OR p_event>now()+interval '5 minutes' OR length(closing)>10000 OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_timezone) THEN RAISE EXCEPTION 'Invalid clock operation'; END IF;
 args:=jsonb_build_object('action',p_action,'expected',p_expected,'event',p_event,'job',job,'comment',closing,'timezone',p_timezone);
 PERFORM pg_advisory_xact_lock(hashtextextended('vihem-clock:'||actor.id::text,0));
 SELECT * INTO receipt FROM public.vihem_clock_operations WHERE id=p_id;
 IF receipt.id IS NOT NULL THEN
  IF receipt.user_id IS DISTINCT FROM actor.id OR receipt.organisation_id IS DISTINCT FROM actor.organisation_id OR receipt.request IS DISTINCT FROM args THEN RAISE EXCEPTION 'Operation identity mismatch' USING ERRCODE='42501'; END IF;
  RETURN receipt.result;
 END IF;
 SELECT count(*) INTO count_open FROM public.vihem_time_entries WHERE user_id=actor.id AND end_time IS NULL;
 IF count_open>1 THEN RAISE EXCEPTION 'OPEN_ENTRY_CONFLICT'; END IF;
 SELECT * INTO current_entry FROM public.vihem_time_entries WHERE user_id=actor.id AND end_time IS NULL FOR UPDATE;
 IF current_entry.id IS DISTINCT FROM p_expected OR (current_entry.id IS NOT NULL AND current_entry.organisation_id IS DISTINCT FROM actor.organisation_id) THEN RAISE EXCEPTION 'CLOCK_STATE_CONFLICT' USING ERRCODE='23505'; END IF;
 IF current_entry.id IS NULL AND EXISTS(SELECT 1 FROM public.vihem_time_entries WHERE user_id=actor.id AND end_time>p_event) THEN RAISE EXCEPTION 'CLOCK_STATE_CONFLICT' USING ERRCODE='23505'; END IF;
 IF p_action='clockin' AND current_entry.id IS NOT NULL THEN RAISE EXCEPTION 'CLOCK_STATE_CONFLICT' USING ERRCODE='23505'; END IF;
 IF p_action<>'clockin' AND current_entry.id IS NULL THEN RAISE EXCEPTION 'No active entry'; END IF;
 IF current_entry.id IS NOT NULL AND p_event<current_entry.start_time THEN RAISE EXCEPTION 'Event precedes active entry'; END IF;
 IF p_action IN ('break','lunch') AND current_entry.entry_type IN ('break','lunch') THEN RAISE EXCEPTION 'Pause already active'; END IF;
 IF p_action='resume' AND current_entry.entry_type NOT IN ('break','lunch') THEN RAISE EXCEPTION 'No active pause'; END IF;
 IF current_entry.entry_type IN ('break','lunch') THEN
  IF EXISTS(SELECT 1 FROM public.vihem_clock_operations WHERE id=current_entry.id AND user_id=actor.id AND organisation_id=actor.organisation_id) THEN
   SELECT * INTO previous FROM public.vihem_time_entries WHERE id=(SELECT (o.result->>'closed')::uuid FROM public.vihem_clock_operations o WHERE o.id=current_entry.id) AND user_id=actor.id AND organisation_id=actor.organisation_id AND entry_type='work' FOR UPDATE;
  ELSE
   -- Existing pauses predate operation receipts; preserve their historical fallback.
   SELECT * INTO previous FROM public.vihem_time_entries WHERE user_id=actor.id AND organisation_id=actor.organisation_id AND entry_type='work' AND end_time<=current_entry.start_time ORDER BY end_time DESC LIMIT 1 FOR UPDATE;
  END IF;
 END IF;
 subject:=CASE WHEN current_entry.entry_type IN ('break','lunch') THEN previous ELSE current_entry END;
 IF p_action IN ('switch','clockout') AND subject.id IS NOT NULL AND subject.category<>'work_order' AND (subject.category<>'customer_project' OR subject.project_billing_scope='outside_quote') AND NOT(subject.snow_client_id IS NOT NULL AND subject.category IN ('snow_plowing','snow_sanding')) AND length(closing)<4 AND NOT(p_action='switch' AND NULLIF(job->>'work_order_id','') IS NOT NULL) AND NOT(p_action='clockout' AND closing_status='submitted' AND current_entry.work_order_id IS NOT NULL) THEN RAISE EXCEPTION 'Closing comment required'; END IF;
 IF p_action='resume' THEN
  IF previous.id IS NULL THEN RAISE EXCEPTION 'No previous work to resume'; END IF;
  job:=jsonb_build_object('category',previous.category,'work_order_id',previous.work_order_id,'customer_project_id',previous.customer_project_id,'customer_name',previous.customer_name,'project_billing_scope',previous.project_billing_scope,'project_change_order_id',previous.project_change_order_id,'snow_client_id',previous.snow_client_id,'snow_route_id',previous.snow_route_id,'snow_method',previous.snow_method);
 END IF;
 IF p_action IN ('clockin','switch','resume') THEN
  category_value:=job->>'category';
  IF category_value IN ('snow_plowing','snow_sanding') THEN
   IF NOT public.vihem_snow_access() OR job->>'snow_method' NOT IN ('machine','hand') OR job->>'snow_method' IS NULL THEN RAISE EXCEPTION 'Snöbehörighet eller arbetsmetod saknas' USING ERRCODE='42501';END IF;
   SELECT * INTO snow_client FROM public.vihem_snow_clients WHERE id=NULLIF(job->>'snow_client_id','')::uuid AND organisation_id=actor.organisation_id AND active;
   IF snow_client.id IS NULL THEN RAISE EXCEPTION 'Välj aktiv snöuppdragsgivare';END IF;
   IF NULLIF(job->>'snow_route_id','') IS NOT NULL THEN
    SELECT * INTO snow_route FROM public.vihem_snow_routes WHERE id=(job->>'snow_route_id')::uuid AND organisation_id=actor.organisation_id AND client_id=snow_client.id AND method=job->>'snow_method' AND active;
    IF snow_route.id IS NULL THEN RAISE EXCEPTION 'Rutt/område matchar inte uppdragsgivare eller metod';END IF;
   END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.vihem_time_categories WHERE organisation_id=actor.organisation_id AND key=category_value AND active) THEN RAISE EXCEPTION 'Time category unavailable'; END IF;
  wo:=NULLIF(job->>'work_order_id','')::uuid;project:=NULLIF(job->>'customer_project_id','')::uuid;change_order:=NULLIF(job->>'project_change_order_id','')::uuid;
  IF wo IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vihem_work_orders WHERE id=wo AND organisation_id=actor.organisation_id) THEN RAISE EXCEPTION 'Work order access denied' USING ERRCODE='42501'; END IF;
  scope_value:=CASE WHEN category_value='customer_project' THEN COALESCE(job->>'project_billing_scope','included_in_quote') ELSE 'internal' END;
  IF scope_value NOT IN ('internal','included_in_quote','outside_quote') THEN RAISE EXCEPTION 'Invalid billing scope'; END IF;
  customer:=CASE WHEN snow_client.id IS NOT NULL THEN snow_client.name ELSE NULLIF(job->>'customer_name','') END;
  IF category_value='customer_project' THEN
   IF project IS NULL OR NOT public.can_access_customer_project(project) OR NOT EXISTS(SELECT 1 FROM public.vihem_customer_projects WHERE id=project AND organisation_id=actor.organisation_id) THEN RAISE EXCEPTION 'Project access denied' USING ERRCODE='42501'; END IF;
   SELECT customer_name INTO customer FROM public.vihem_customer_projects WHERE id=project;
   IF change_order IS NOT NULL AND (scope_value<>'outside_quote' OR NOT EXISTS(SELECT 1 FROM public.vihem_project_change_orders WHERE id=change_order AND project_id=project)) THEN RAISE EXCEPTION 'Change order access denied' USING ERRCODE='42501'; END IF;
  ELSE project:=NULL;change_order:=NULL; END IF;
 END IF;
 -- All validation precedes any entry writes. Later errors still roll back the transaction.
 IF current_entry.id IS NOT NULL THEN
  UPDATE public.vihem_time_entries SET end_time=p_event,total_minutes=GREATEST(floor(extract(epoch FROM (p_event-start_time))/60)::integer-CASE WHEN entry_type IN ('break','lunch') THEN 0 ELSE break_minutes END,0),status=closing_status,approved_by=NULL,approved_at=CASE WHEN closing_status='approved' THEN p_event ELSE NULL END,updated_at=now()
  WHERE id=current_entry.id;
 END IF;
 IF p_action IN ('switch','clockout') AND closing<>'' AND subject.id IS NOT NULL THEN
  UPDATE public.vihem_time_entries SET comment=CASE WHEN btrim(COALESCE(comment,''))='' THEN closing ELSE btrim(comment)||E'\n'||closing END,updated_at=now() WHERE id=subject.id;
 END IF;
 IF p_action<>'clockout' THEN
  INSERT INTO public.vihem_time_entries(id,user_id,organisation_id,work_order_id,category,entry_type,customer_project_id,customer_name,project_billing_scope,project_change_order_id,start_time,end_time,break_minutes,total_minutes,comment,status)
  VALUES(p_id,actor.id,actor.organisation_id,wo,CASE WHEN p_action IN ('break','lunch') THEN 'general' ELSE category_value END,CASE WHEN p_action IN ('break','lunch') THEN p_action ELSE 'work' END,project,customer,COALESCE(scope_value,'internal'),change_order,p_event,NULL,0,0,CASE WHEN p_action IN ('clockin','switch') AND opening<>'' THEN opening WHEN p_action='clockin' THEN closing WHEN p_action='break' THEN 'Rast' WHEN p_action='lunch' THEN 'Lunch' ELSE '' END,'draft') RETURNING * INTO next_entry;
  IF p_action IN ('break','lunch') AND subject.snow_client_id IS NOT NULL THEN
   UPDATE public.vihem_time_entries SET snow_client_id=subject.snow_client_id,snow_route_id=subject.snow_route_id,snow_method=subject.snow_method,customer_name=subject.customer_name WHERE id=next_entry.id RETURNING * INTO next_entry;
  END IF;
  IF snow_client.id IS NOT NULL THEN
   UPDATE public.vihem_time_entries SET snow_client_id=snow_client.id,snow_route_id=snow_route.id,snow_method=job->>'snow_method' WHERE id=next_entry.id RETURNING * INTO next_entry;
  END IF;
 END IF;
 IF p_action='clockout' AND closing<>'' THEN
  date_value:=(p_event AT TIME ZONE p_timezone)::date;
  INSERT INTO public.vihem_daily_work_summaries(user_id,work_date,comment,updated_at) VALUES(actor.id,date_value,closing,now()) ON CONFLICT(user_id,work_date) DO UPDATE SET comment=CASE WHEN btrim(COALESCE(vihem_daily_work_summaries.comment,''))='' THEN EXCLUDED.comment ELSE btrim(vihem_daily_work_summaries.comment)||E'\n'||EXCLUDED.comment END,updated_at=now();
 END IF;
 result:=jsonb_build_object('operation',p_id,'closed',current_entry.id,'current',CASE WHEN next_entry.id IS NULL THEN NULL ELSE to_jsonb(next_entry) END,'event_at',p_event,'received_at',now());
 INSERT INTO public.vihem_clock_operations(id,user_id,organisation_id,request,result,event_at) VALUES(p_id,actor.id,actor.organisation_id,args,result,p_event);
 RETURN result;
END $$;

-- Extend the existing staff editor allowlist without changing its atomic save logic.
DO $$DECLARE f text;BEGIN
 SELECT pg_get_functiondef('public.vihem_save_staff_editor(uuid,uuid,jsonb,jsonb,text[],text[])'::regprocedure) INTO f;
 IF position('''snow''' in f)=0 THEN
  IF position('''jour'',''fleet_management''' in f)=0 THEN RAISE EXCEPTION 'Staff editor allowlist changed; review migration';END IF;
  EXECUTE replace(f,'''jour'',''fleet_management''','''jour'',''snow'',''fleet_management''');
 END IF;
END$$;
NOTIFY pgrst, 'reload schema';
COMMIT;
