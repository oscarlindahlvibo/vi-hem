-- Preserve work-order opening comments and submitted clock-out status using the atomic transition.
CREATE OR REPLACE FUNCTION public.vihem_clock_transition(p_id uuid,p_action text,p_expected uuid,p_event timestamptz,p_job jsonb DEFAULT '{}'::jsonb,p_comment text DEFAULT '',p_timezone text DEFAULT 'Europe/Stockholm')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 actor public.vihem_profiles%ROWTYPE; current_entry public.vihem_time_entries%ROWTYPE; previous public.vihem_time_entries%ROWTYPE; next_entry public.vihem_time_entries%ROWTYPE;
 receipt public.vihem_clock_operations%ROWTYPE; args jsonb; result jsonb; job jsonb:=COALESCE(p_job,'{}'::jsonb); closing text:=btrim(COALESCE(p_comment,''));
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
 IF p_action IN ('switch','clockout') AND subject.id IS NOT NULL AND subject.category<>'work_order' AND (subject.category<>'customer_project' OR subject.project_billing_scope='outside_quote') AND length(closing)<4 AND NOT(p_action='switch' AND NULLIF(job->>'work_order_id','') IS NOT NULL) AND NOT(p_action='clockout' AND closing_status='submitted' AND current_entry.work_order_id IS NOT NULL) THEN RAISE EXCEPTION 'Closing comment required'; END IF;
 IF p_action='resume' THEN
  IF previous.id IS NULL THEN RAISE EXCEPTION 'No previous work to resume'; END IF;
  job:=jsonb_build_object('category',previous.category,'work_order_id',previous.work_order_id,'customer_project_id',previous.customer_project_id,'customer_name',previous.customer_name,'project_billing_scope',previous.project_billing_scope,'project_change_order_id',previous.project_change_order_id);
 END IF;
 IF p_action IN ('clockin','switch','resume') THEN
  category_value:=job->>'category';
  IF NOT EXISTS(SELECT 1 FROM public.vihem_time_categories WHERE organisation_id=actor.organisation_id AND key=category_value AND active) THEN RAISE EXCEPTION 'Time category unavailable'; END IF;
  wo:=NULLIF(job->>'work_order_id','')::uuid;project:=NULLIF(job->>'customer_project_id','')::uuid;change_order:=NULLIF(job->>'project_change_order_id','')::uuid;
  IF wo IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vihem_work_orders WHERE id=wo AND organisation_id=actor.organisation_id) THEN RAISE EXCEPTION 'Work order access denied' USING ERRCODE='42501'; END IF;
  scope_value:=CASE WHEN category_value='customer_project' THEN COALESCE(job->>'project_billing_scope','included_in_quote') ELSE 'internal' END;
  IF scope_value NOT IN ('internal','included_in_quote','outside_quote') THEN RAISE EXCEPTION 'Invalid billing scope'; END IF;
  customer:=NULLIF(job->>'customer_name','');
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
 END IF;
 IF p_action='clockout' AND closing<>'' THEN
  date_value:=(p_event AT TIME ZONE p_timezone)::date;
  INSERT INTO public.vihem_daily_work_summaries(user_id,work_date,comment,updated_at) VALUES(actor.id,date_value,closing,now()) ON CONFLICT(user_id,work_date) DO UPDATE SET comment=CASE WHEN btrim(COALESCE(vihem_daily_work_summaries.comment,''))='' THEN EXCLUDED.comment ELSE btrim(vihem_daily_work_summaries.comment)||E'\n'||EXCLUDED.comment END,updated_at=now();
 END IF;
 result:=jsonb_build_object('operation',p_id,'closed',current_entry.id,'current',CASE WHEN next_entry.id IS NULL THEN NULL ELSE to_jsonb(next_entry) END,'event_at',p_event,'received_at',now());
 INSERT INTO public.vihem_clock_operations(id,user_id,organisation_id,request,result,event_at) VALUES(p_id,actor.id,actor.organisation_id,args,result,p_event);
 RETURN result;
END $$;
NOTIFY pgrst, 'reload schema';
