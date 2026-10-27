BEGIN;
CREATE FUNCTION public.vihem_snow_offer(p_duty uuid,p_user uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d vihem_snow_duties;i uuid;BEGIN
 SELECT * INTO STRICT d FROM vihem_snow_duties WHERE id=p_duty FOR UPDATE;
 IF d.ends_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM vihem_snow_clients WHERE id=d.client_id AND active) OR d.state NOT IN ('planned','calling') OR d.accepted_user IS NOT NULL OR NOT vihem_snow_candidate(d.organisation_id,p_user,d.resource_id,d.starts_at,d.ends_at,d.id) THEN RAISE EXCEPTION 'Föraren kan inte bokas nu';END IF;
 INSERT INTO vihem_snow_invitations(organisation_id,duty_id,user_id,expires_at) VALUES(d.organisation_id,d.id,p_user,clock_timestamp()+make_interval(mins=>(vihem_snow_config(d.organisation_id)->>'response_minutes')::int)) ON CONFLICT(duty_id,user_id) DO NOTHING RETURNING id INTO i;
 IF i IS NOT NULL THEN
 UPDATE vihem_snow_duties SET state='calling',revision=revision+1 WHERE id=d.id;
 PERFORM vihem_snow_notice(d.organisation_id,p_user,'invite:'||i,'callout',i,'Utkallning · Snö & halka',(SELECT c.name||' · '||r.name FROM vihem_snow_clients c,vihem_snow_resources r WHERE c.id=d.client_id AND r.id=d.resource_id)||' · Start '||to_char(d.starts_at AT TIME ZONE 'Europe/Stockholm','DD/MM HH24:MI')||'. Öppna appen och svara. '||d.message);
 INSERT INTO vihem_snow_events(organisation_id,actor_id,kind,object_id,details) VALUES(d.organisation_id,auth.uid(),'invited',d.id,jsonb_build_object('user',p_user,'invitation',i));END IF;RETURN i;
END$$;
CREATE FUNCTION public.vihem_snow_candidates(p_duty uuid) RETURNS TABLE(user_id uuid,name text,worked_minutes bigint) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT p.id,p.name,coalesce((SELECT sum(total_minutes)::bigint FROM vihem_time_entries WHERE user_id=p.id AND snow_client_id IS NOT NULL AND start_time>now()-interval '30 days'),0)
 FROM vihem_snow_duties d JOIN vihem_profiles p ON p.organisation_id=d.organisation_id
 WHERE d.id=p_duty AND vihem_snow_candidate(d.organisation_id,p.id,d.resource_id,d.starts_at,d.ends_at,d.id)
 AND NOT EXISTS(SELECT 1 FROM vihem_snow_invitations i WHERE i.duty_id=d.id AND i.user_id=p.id)
 ORDER BY 3,p.id
$$;
-- Generic idempotent command envelope; every branch is validated server-side.
CREATE FUNCTION public.vihem_snow_command(p_id uuid,p_action text,p_data jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE org uuid:=vihem_get_my_org_id();who uuid:=auth.uid();admin boolean:=vihem_snow_admin();receipt vihem_snow_operations;result jsonb:='{}';target uuid;obj uuid;d vihem_snow_duties;i vihem_snow_invitations;x jsonb;v uuid;w date;settings jsonb;expected int;BEGIN
 IF NOT vihem_snow_access() OR p_id IS NULL OR p_action IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR pg_column_size(p_data)>64000 THEN RAISE EXCEPTION 'Åtkomst nekad eller ogiltig begäran' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('snow-availability:'||org::text,0));
 SELECT * INTO receipt FROM vihem_snow_operations WHERE id=p_id;
 IF FOUND THEN IF receipt.actor_id<>who OR receipt.organisation_id<>org OR receipt.action<>p_action OR receipt.request IS DISTINCT FROM p_data THEN RAISE EXCEPTION 'Operations-ID används för annan begäran' USING ERRCODE='42501';END IF;RETURN receipt.result;END IF;
 IF p_action IN ('settings','resource','competency','assignment','plan','plan_update','callout','cancel_duty','review','price','invoice_prepare','invoice_release','customer_update') AND NOT admin THEN RAISE EXCEPTION 'Snöadministration krävs' USING ERRCODE='42501';END IF;
 CASE p_action
 WHEN 'settings' THEN
  settings:=p_data-'revision';
  IF (settings->>'max_hours')::int NOT BETWEEN 1 AND 24 OR (settings->>'rest_hours')::int NOT BETWEEN 0 AND 24 OR (settings->>'response_minutes')::int NOT BETWEEN 1 AND 60 OR (settings->>'remind_minutes')::int NOT BETWEEN 1 AND 59 OR (settings->>'remind_minutes')::int>=(settings->>'response_minutes')::int OR (settings->>'weekly_day')::int NOT BETWEEN 1 AND 7 OR (settings->>'weekly_hour')::int NOT BETWEEN 0 AND 23 OR jsonb_typeof(settings->'auto_approve') IS DISTINCT FROM 'boolean' OR NOT(settings ?& ARRAY['max_hours','rest_hours','response_minutes','remind_minutes','weekly_day','weekly_hour','auto_approve']) THEN RAISE EXCEPTION 'Kontrollera inställningarna';END IF;
  SELECT revision INTO expected FROM vihem_snow_settings WHERE organisation_id=org;
  IF coalesce(expected,0) IS DISTINCT FROM (p_data->>'revision')::int THEN RAISE EXCEPTION 'Inställningarna har ändrats' USING ERRCODE='40001';END IF;
  INSERT INTO vihem_snow_settings VALUES(org,settings,1) ON CONFLICT(organisation_id) DO UPDATE SET settings=excluded.settings,revision=vihem_snow_settings.revision+1;
 WHEN 'resource' THEN
  v:=nullif(p_data->>'vehicle_id','')::uuid;
  IF v IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vihem_fleet_vehicles WHERE id=v AND organisation_id=org AND active) THEN RAISE EXCEPTION 'Maskinen tillhör inte organisationen';END IF;
  obj:=p_id;INSERT INTO vihem_snow_resources(id,organisation_id,vehicle_id,name,method) VALUES(obj,org,v,btrim(p_data->>'name'),coalesce(p_data->>'method','machine'));
 WHEN 'competency' THEN
  target:=(p_data->>'user_id')::uuid;obj:=(p_data->>'resource_id')::uuid;
  IF NOT EXISTS(SELECT 1 FROM vihem_profiles WHERE id=target AND organisation_id=org AND active AND role IN ('admin','superadmin','staff','snow')) OR NOT EXISTS(SELECT 1 FROM vihem_snow_resources WHERE id=obj AND organisation_id=org AND active) THEN RAISE EXCEPTION 'Ogiltig förare eller resurs';END IF;
  INSERT INTO vihem_snow_competencies VALUES(org,target,obj,(p_data->>'active')::boolean) ON CONFLICT(user_id,resource_id) DO UPDATE SET active=excluded.active;
 WHEN 'assignment' THEN
  obj:=(p_data->>'id')::uuid;target:=nullif(p_data->>'finance_customer_id','')::uuid;v:=nullif(p_data->>'company_id','')::uuid;
  IF target IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vihem_finance_customers WHERE id=target AND organisation_id=org AND active) THEN RAISE EXCEPTION 'Välj kund i organisationen';END IF;
  IF v IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vihem_companies WHERE id=v AND organisation_id=org) THEN RAISE EXCEPTION 'Välj bolag i organisationen';END IF;
  UPDATE vihem_snow_clients SET finance_customer_id=target,company_id=v,invoice_reference=left(coalesce(p_data->>'reference',''),200),cost_center=left(coalesce(p_data->>'cost_center',''),100),revision=revision+1 WHERE id=obj AND organisation_id=org AND revision=(p_data->>'revision')::int;
  IF NOT FOUND THEN RAISE EXCEPTION 'Uppdraget har ändrats' USING ERRCODE='40001';END IF;
 WHEN 'pattern' THEN
  target:=coalesce(nullif(p_data->>'user_id','')::uuid,who);
  IF target<>who AND NOT admin THEN RAISE EXCEPTION 'Endast egen tillgänglighet' USING ERRCODE='42501';END IF;
  IF NOT EXISTS(SELECT 1 FROM vihem_profiles WHERE id=target AND organisation_id=org AND active) OR jsonb_typeof(p_data->'days') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'days')<>7 THEN RAISE EXCEPTION 'Ange veckans sju dagar';END IF;
  IF EXISTS(SELECT 1 FROM vihem_snow_patterns WHERE organisation_id=org AND user_id=target) AND coalesce(p_data->>'revision','') IS DISTINCT FROM (SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY weekday),'[]')::text) FROM vihem_snow_patterns p WHERE organisation_id=org AND user_id=target) THEN RAISE EXCEPTION 'Grundveckan har ändrats. Läs in den igen.' USING ERRCODE='40001';END IF;
  DELETE FROM vihem_snow_patterns WHERE organisation_id=org AND user_id=target;
  FOR x IN SELECT value FROM jsonb_array_elements(p_data->'days') LOOP
   INSERT INTO vihem_snow_patterns(organisation_id,user_id,weekday,slots) VALUES(org,target,(x->>'weekday')::int,x->'slots');
  END LOOP;
 WHEN 'confirm_week' THEN
  target:=who;w:=(p_data->>'week')::date;
  IF w IS NULL OR NOT isfinite(w) OR extract(isodow FROM w)<>1 OR w<current_date-14 OR w>current_date+90 OR NOT(p_data ? 'available') THEN RAISE EXCEPTION 'Välj en aktuell måndagsvecka';END IF;
  INSERT INTO vihem_snow_week_confirmations VALUES(org,target,w,(p_data->>'available')::boolean,clock_timestamp()) ON CONFLICT(organisation_id,user_id,week_start) DO UPDATE SET available=excluded.available,confirmed_at=excluded.confirmed_at;
 WHEN 'plan' THEN
  obj:=p_id;INSERT INTO vihem_snow_duties(id,organisation_id,client_id,resource_id,starts_at,ends_at,planned_user,activity,message,created_by)
  VALUES(obj,org,(p_data->>'client_id')::uuid,(p_data->>'resource_id')::uuid,(p_data->>'starts_at')::timestamptz,(p_data->>'ends_at')::timestamptz,nullif(p_data->>'user_id','')::uuid,p_data->>'activity',left(coalesce(p_data->>'message',''),2000),who) RETURNING * INTO d;
  IF NOT EXISTS(SELECT 1 FROM vihem_snow_clients WHERE id=d.client_id AND active) OR NOT EXISTS(SELECT 1 FROM vihem_snow_resources WHERE id=d.resource_id AND active) OR (d.planned_user IS NOT NULL AND NOT vihem_snow_candidate(org,d.planned_user,d.resource_id,d.starts_at,d.ends_at,d.id)) THEN RAISE EXCEPTION 'Kunden/resursen är inaktiv eller föraren saknar aktuell tillgänglighet, kompetens eller vila';END IF;
 WHEN 'plan_update' THEN
  obj:=(p_data->>'id')::uuid;
  UPDATE vihem_snow_duties SET client_id=(p_data->>'client_id')::uuid,resource_id=(p_data->>'resource_id')::uuid,starts_at=(p_data->>'starts_at')::timestamptz,ends_at=(p_data->>'ends_at')::timestamptz,planned_user=nullif(p_data->>'user_id','')::uuid,activity=p_data->>'activity',message=left(coalesce(p_data->>'message',''),2000),revision=revision+1
  WHERE id=obj AND organisation_id=org AND state='planned' AND revision=(p_data->>'revision')::int RETURNING * INTO d;
  IF d.id IS NULL OR NOT EXISTS(SELECT 1 FROM vihem_snow_clients WHERE id=d.client_id AND organisation_id=org AND active) OR NOT EXISTS(SELECT 1 FROM vihem_snow_resources WHERE id=d.resource_id AND organisation_id=org AND active) OR (d.planned_user IS NOT NULL AND NOT vihem_snow_candidate(org,d.planned_user,d.resource_id,d.starts_at,d.ends_at,d.id)) THEN RAISE EXCEPTION 'Planeringen har ändrats eller föraren är inte tillgänglig' USING ERRCODE='40001';END IF;
 WHEN 'callout' THEN
  IF jsonb_typeof(p_data->'duties') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'duties') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Välj 1–100 planerade pass';END IF;
  FOR x IN SELECT value FROM jsonb_array_elements(p_data->'duties') LOOP
   SELECT * INTO d FROM vihem_snow_duties WHERE id=(x#>>'{}')::uuid AND organisation_id=org FOR UPDATE;
   IF d.id IS NULL OR d.state<>'planned' THEN RAISE EXCEPTION 'Ett valt pass är inte längre planerat';END IF;
   target:=d.planned_user;
   IF target IS NULL THEN SELECT user_id INTO target FROM vihem_snow_candidates(d.id) LIMIT 1;END IF;
   IF target IS NULL THEN RAISE EXCEPTION 'Passet saknar tillgänglig behörig förare';END IF;
   PERFORM vihem_snow_offer(d.id,target);
  END LOOP;
 WHEN 'respond' THEN
  SELECT * INTO i FROM vihem_snow_invitations WHERE id=(p_data->>'invitation_id')::uuid AND organisation_id=org AND user_id=who FOR UPDATE;
  IF i.id IS NULL THEN RAISE EXCEPTION 'Egen utkallning saknas' USING ERRCODE='42501';END IF;
  SELECT * INTO STRICT d FROM vihem_snow_duties WHERE id=i.duty_id FOR UPDATE;obj:=d.id;
  IF i.state<>'pending' OR i.expires_at<=clock_timestamp() OR d.state<>'calling' OR d.accepted_user IS NOT NULL THEN RAISE EXCEPTION 'Förfrågan är inte längre öppen. Ingen bokning har gjorts.' USING ERRCODE='40001';END IF;
  IF jsonb_typeof(p_data->'accept') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Välj ett svar';END IF;
  IF (p_data->>'accept')::boolean THEN
   IF NOT vihem_snow_candidate(org,who,d.resource_id,d.starts_at,d.ends_at,d.id) THEN RAISE EXCEPTION 'Din tillgänglighet, kompetens eller vila har ändrats';END IF;
   UPDATE vihem_snow_invitations SET state='superseded',responded_at=clock_timestamp() WHERE duty_id=d.id AND id<>i.id AND state='pending';
   UPDATE vihem_snow_invitations SET state='accepted',responded_at=clock_timestamp() WHERE id=i.id;
   UPDATE vihem_snow_duties SET accepted_user=who,state='accepted',revision=revision+1 WHERE id=d.id;
  ELSE UPDATE vihem_snow_invitations SET state='declined',responded_at=clock_timestamp() WHERE id=i.id;END IF;
 WHEN 'cancel_duty' THEN
  obj:=(p_data->>'duty_id')::uuid;
  UPDATE vihem_snow_duties SET state='cancelled',revision=revision+1 WHERE id=obj AND organisation_id=org AND revision=(p_data->>'revision')::int AND state NOT IN ('working','done');
  IF NOT FOUND THEN RAISE EXCEPTION 'Passet har ändrats eller är igång';END IF;
  UPDATE vihem_snow_invitations SET state='superseded' WHERE duty_id=obj AND state='pending';
 WHEN 'relief' THEN
  SELECT * INTO d FROM vihem_snow_duties WHERE id=(p_data->>'duty_id')::uuid AND organisation_id=org AND accepted_user=who AND state IN ('accepted','working') FOR UPDATE;
  IF d.id IS NULL OR (p_data->>'at')::timestamptz<=greatest(clock_timestamp(),d.starts_at) OR (p_data->>'at')::timestamptz>=d.ends_at THEN RAISE EXCEPTION 'Välj avlösningstid under ditt kommande/pågående pass';END IF;
  obj:=p_id;
  UPDATE vihem_snow_duties SET ends_at=(p_data->>'at')::timestamptz,revision=revision+1 WHERE id=d.id;
  INSERT INTO vihem_snow_duties(id,organisation_id,client_id,resource_id,starts_at,ends_at,activity,message,relief_of,created_by)
  VALUES(obj,org,d.client_id,d.resource_id,(p_data->>'at')::timestamptz,d.ends_at,d.activity,left(coalesce(p_data->>'message','Avlösning'),2000),d.id,who);
  -- The original duty ends at the handover; actual clock-out remains a driver action.
  SELECT user_id INTO target FROM vihem_snow_candidates(obj) LIMIT 1;
  IF target IS NOT NULL THEN PERFORM vihem_snow_offer(obj,target);END IF;
  -- No replacement is falsely shown as confirmed when no one accepts.
 WHEN 'customer_create' THEN
  obj:=p_id;
  IF length(btrim(p_data->>'name')) NOT BETWEEN 2 AND 150 OR p_data->>'customer_type' NOT IN ('private','company') THEN RAISE EXCEPTION 'Ange kundens namn och typ';END IF;
  INSERT INTO vihem_finance_customers(id,organisation_id,name,customer_type,email,phone,address_line1,postal_code,city,created_by)
  VALUES(obj,org,btrim(p_data->>'name'),p_data->>'customer_type',left(coalesce(p_data->>'email',''),200),left(coalesce(p_data->>'phone',''),40),left(coalesce(p_data->>'address',''),200),left(coalesce(p_data->>'postal_code',''),20),left(coalesce(p_data->>'city',''),100),who);
 WHEN 'extra_assignment' THEN
  target:=(p_data->>'customer_id')::uuid;
  IF NOT EXISTS(SELECT 1 FROM vihem_finance_customers WHERE id=target AND organisation_id=org AND active) OR length(btrim(p_data->>'name')) NOT BETWEEN 2 AND 150 THEN RAISE EXCEPTION 'Välj befintlig kund och beskriv extrauppdraget';END IF;
  obj:=p_id;INSERT INTO vihem_snow_clients(id,organisation_id,name,finance_customer_id,instructions,rut_requested) VALUES(obj,org,btrim(p_data->>'name'),target,left(coalesce(p_data->>'instructions',''),5000),coalesce((p_data->>'rut_requested')::boolean,false));
 ELSE
  -- Billing/review actions implemented in the next migration, with the same transaction/receipt.
  IF p_action IN ('review','price','invoice_prepare','invoice_release','customer_update') AND admin THEN result:=vihem_snow_billing_command(p_id,p_action,p_data,org,who);
  ELSE RAISE EXCEPTION 'Okänd snöåtgärd';END IF;
 END CASE;
 IF obj IS NOT NULL THEN result:=result||jsonb_build_object('id',obj);END IF;
 INSERT INTO vihem_snow_events(organisation_id,actor_id,kind,object_id,details) VALUES(org,who,p_action,obj,p_data-ARRAY['personnummer','email','phone','address']);
 INSERT INTO vihem_snow_operations VALUES(p_id,org,who,p_action,p_data,result,clock_timestamp());
 RETURN result;
END$$;
-- Server-side scheduler: install a service-role cron separately, never from this migration.
CREATE FUNCTION public.vihem_snow_dispatch() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE org uuid;d vihem_snow_duties;i vihem_snow_invitations;n vihem_snow_notices;p record;target uuid;c jsonb;w date;local_now timestamp;count_notices int:=0;before_org int;BEGIN
 FOR org IN SELECT m.organisation_id FROM vihem_organisation_modules m WHERE m.module_key='snow' AND m.enabled ORDER BY m.organisation_id LOOP
 BEGIN
  before_org:=count_notices;
  PERFORM pg_advisory_xact_lock(hashtextextended('snow-availability:'||org::text,0));c:=vihem_snow_config(org);
  FOR d IN SELECT * FROM vihem_snow_duties WHERE organisation_id=org AND state='calling' ORDER BY starts_at LIMIT 100 FOR UPDATE LOOP
   IF d.ends_at<=clock_timestamp() THEN UPDATE vihem_snow_invitations SET state='expired' WHERE duty_id=d.id AND state='pending';UPDATE vihem_snow_duties SET state='cancelled',revision=revision+1 WHERE id=d.id;CONTINUE;END IF;
   FOR i IN SELECT * FROM vihem_snow_invitations WHERE duty_id=d.id AND state='pending' FOR UPDATE LOOP
    IF i.expires_at<=clock_timestamp() THEN UPDATE vihem_snow_invitations SET state='expired' WHERE id=i.id;
    ELSIF NOT i.reminded AND i.created_at+make_interval(mins=>(c->>'remind_minutes')::int)<=clock_timestamp() THEN
     PERFORM vihem_snow_notice(org,i.user_id,'remind:'||i.id,'callout',i.id,'Svar saknas på snöutkallning','Öppna Snö & halka och välj Jag kommer eller Kan inte köra.');UPDATE vihem_snow_invitations SET reminded=true WHERE id=i.id;
    END IF;
   END LOOP;
   IF NOT EXISTS(SELECT 1 FROM vihem_snow_invitations WHERE duty_id=d.id AND state='pending') THEN
    SELECT user_id INTO target FROM vihem_snow_candidates(d.id) LIMIT 1;
    IF target IS NOT NULL THEN PERFORM vihem_snow_offer(d.id,target);
    ELSE
     FOR p IN SELECT id FROM vihem_profiles WHERE organisation_id=org AND active AND role IN ('admin','superadmin') LOOP
      PERFORM vihem_snow_notice(org,p.id,'gap:'||d.id||':'||p.id,'gap',d.id,'Bemanningslucka · Snö & halka','Ingen lämplig obesvarad reserv finns. Kontrollera bemanningen och kontakta förare manuellt.');
     END LOOP;
    END IF;
   END IF;
  END LOOP;
  local_now:=clock_timestamp() AT TIME ZONE 'Europe/Stockholm';w:=local_now::date-(extract(isodow FROM local_now)::int-1)+7;
  IF extract(isodow FROM local_now)=(c->>'weekly_day')::int AND extract(hour FROM local_now)>=(c->>'weekly_hour')::int THEN
   FOR p IN SELECT id FROM vihem_profiles WHERE organisation_id=org AND vihem_snow_worker(id,org) LOOP
    IF NOT EXISTS(SELECT 1 FROM vihem_snow_week_confirmations WHERE organisation_id=org AND user_id=p.id AND week_start=w AND NOT EXISTS(SELECT 1 FROM vihem_snow_patterns sp WHERE sp.user_id=p.id AND sp.organisation_id=org AND sp.updated_at>vihem_snow_week_confirmations.confirmed_at) AND NOT EXISTS(SELECT 1 FROM vihem_snow_availability sa WHERE sa.user_id=p.id AND sa.organisation_id=org AND sa.work_date BETWEEN w AND w+6 AND sa.updated_at>vihem_snow_week_confirmations.confirmed_at)) THEN
     PERFORM vihem_snow_notice(org,p.id,'week:'||w||':'||p.id,'week',NULL,'Bekräfta din snötillgänglighet','Kontrollera nästa vecka och bekräfta när du frivilligt kan köra. Detta bokar inget arbetspass.');
    END IF;
   END LOOP;
  END IF;
  FOR n IN SELECT * FROM vihem_snow_notices WHERE organisation_id=org AND notification_id IS NULL AND closed_at IS NULL ORDER BY created_at LIMIT 200 FOR UPDATE SKIP LOCKED LOOP
   IF NOT vihem_snow_worker(n.user_id,org) THEN UPDATE vihem_snow_notices SET closed_at=clock_timestamp() WHERE id=n.id;CONTINUE;END IF;
   IF n.kind='callout' AND NOT EXISTS(SELECT 1 FROM vihem_snow_invitations WHERE id=n.object_id AND state='pending' AND expires_at>clock_timestamp()) THEN UPDATE vihem_snow_notices SET closed_at=clock_timestamp() WHERE id=n.id;CONTINUE;END IF;
   INSERT INTO vihem_notifications(user_id,organisation_id,title,message,type,link) VALUES(n.user_id,org,n.title,n.message,'info','snow') RETURNING id INTO target;
   UPDATE vihem_snow_notices SET notification_id=target WHERE id=n.id;count_notices:=count_notices+1;
  END LOOP;
 EXCEPTION WHEN OTHERS THEN
  count_notices:=before_org;
  INSERT INTO vihem_snow_events(organisation_id,kind,details) VALUES(org,'dispatch_error',jsonb_build_object('sqlstate',SQLSTATE,'message',left(SQLERRM,300)));
 END;
 END LOOP;RETURN jsonb_build_object('notifications_created',count_notices);
END$$;
REVOKE ALL ON FUNCTION public.vihem_snow_offer(uuid,uuid),public.vihem_snow_candidates(uuid),public.vihem_snow_command(uuid,text,jsonb),public.vihem_snow_dispatch() FROM PUBLIC,authenticated,anon;
GRANT EXECUTE ON FUNCTION public.vihem_snow_command(uuid,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vihem_snow_dispatch() TO service_role;
COMMIT;
