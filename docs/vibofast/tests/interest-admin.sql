-- Run only inside BEGIN/ROLLBACK; pg_net requests cannot dispatch before commit.
DO $$
DECLARE interest_id uuid; contact_id uuid; editor_id uuid; tenant_id uuid; expected integer; actual integer; result jsonb;
BEGIN
  SELECT p.id INTO editor_id FROM public.vihem_profiles p JOIN vihem_vibofast_private.site_content c USING(organisation_id) WHERE p.active AND p.role='admin' LIMIT 1;
  SELECT p.id INTO tenant_id FROM public.vihem_profiles p WHERE p.role='tenant' LIMIT 1;
  IF editor_id IS NULL OR tenant_id IS NULL THEN RAISE EXCEPTION 'Missing test profiles'; END IF;
  SELECT count(*) INTO expected FROM public.vihem_profiles p JOIN vihem_vibofast_private.site_content c USING(organisation_id) WHERE p.active AND p.role='admin';
  interest_id:=public.vihem_vibofast_store_enquiry('interest','{"name":"Transactional test","email":"rollback@example.invalid","message":"Private applicant text"}',gen_random_uuid()::text);
  SELECT count(*) INTO actual FROM public.vihem_notifications WHERE link='vibofast-interests/'||interest_id;
  IF actual<>expected THEN RAISE EXCEPTION 'Wrong notification recipient count: % vs %',actual,expected; END IF;
  IF EXISTS(SELECT 1 FROM public.vihem_notifications n JOIN public.vihem_profiles p ON p.id=n.user_id WHERE n.link='vibofast-interests/'||interest_id AND (NOT p.active OR p.role<>'admin' OR NOT EXISTS(SELECT 1 FROM vihem_vibofast_private.site_content c WHERE c.organisation_id=p.organisation_id))) THEN RAISE EXCEPTION 'Unexpected recipient'; END IF;
  IF EXISTS(SELECT 1 FROM public.vihem_notifications WHERE link='vibofast-interests/'||interest_id AND message LIKE '%Private applicant%') THEN RAISE EXCEPTION 'Personal data leaked to push'; END IF;
  SELECT count(*) INTO actual FROM net.http_request_queue q JOIN public.vihem_notifications n ON (convert_from(q.body,'UTF8')::jsonb->>'notification_id')=n.id::text WHERE n.link='vibofast-interests/'||interest_id;
  IF actual<>expected THEN RAISE EXCEPTION 'Push dispatch was not queued for every recipient'; END IF;
  contact_id:=public.vihem_vibofast_store_enquiry('contact','{"name":"Test","email":"rollback@example.invalid","message":"Contact"}',gen_random_uuid()::text);
  IF EXISTS(SELECT 1 FROM public.vihem_notifications WHERE link='vibofast-interests/'||contact_id) THEN RAISE EXCEPTION 'Contact incorrectly became interest'; END IF;
  PERFORM set_config('request.jwt.claim.sub',editor_id::text,true);
  result:=public.vihem_vibofast_interests(0,interest_id);
  IF jsonb_array_length(result->'items')<>1 OR result->'items'->0->>'status'<>'new' THEN RAISE EXCEPTION 'Admin inbox failed'; END IF;
  PERFORM public.vihem_vibofast_set_interest_status(interest_id,'contacted',1);
  BEGIN
    PERFORM public.vihem_vibofast_set_interest_status(interest_id,'archived',1);
    RAISE EXCEPTION 'Stale revision accepted';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub',tenant_id::text,true);
  BEGIN
    PERFORM public.vihem_vibofast_interests(); RAISE EXCEPTION 'Tenant read accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.vihem_vibofast_set_interest_status(interest_id,'archived',2); RAISE EXCEPTION 'Tenant write accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF has_function_privilege('anon','public.vihem_vibofast_interests(integer,uuid)','EXECUTE') OR has_function_privilege('anon','public.vihem_vibofast_set_interest_status(uuid,text,bigint)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous access granted'; END IF;
  RAISE NOTICE 'PASS: inbox, statuses, revision conflicts, tenant/anonymous rejection, admin recipients and push queue. All probes will roll back.';
END $$;
