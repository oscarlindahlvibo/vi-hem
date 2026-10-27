BEGIN;
CREATE FUNCTION public.vihem_snow_board(p_from date,p_days int DEFAULT 7) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE org uuid:=vihem_get_my_org_id();admin boolean:=vihem_snow_admin();last_day date;BEGIN
 IF NOT vihem_snow_access() THEN RAISE EXCEPTION 'Snöåtkomst krävs' USING ERRCODE='42501';END IF;
 IF p_from IS NULL OR NOT isfinite(p_from) OR p_days NOT BETWEEN 1 AND 31 OR p_days IS NULL THEN RAISE EXCEPTION 'Välj 1–31 dagar';END IF;last_day:=p_from+p_days;
 RETURN jsonb_build_object('server_time',clock_timestamp(),'admin',admin,'settings',vihem_snow_config(org),'settings_revision',coalesce((SELECT revision FROM vihem_snow_settings WHERE organisation_id=org),0),
 'people',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name),'[]') FROM vihem_profiles WHERE organisation_id=org AND active AND role IN ('admin','superadmin','staff','snow') AND (admin OR id=auth.uid())),
 'resources',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.name),'[]') FROM vihem_snow_resources r WHERE r.organisation_id=org),
 'vehicles',CASE WHEN admin THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name),'[]') FROM vihem_fleet_vehicles WHERE organisation_id=org AND active) ELSE '[]'::jsonb END,
 'companies',CASE WHEN admin THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name),'[]') FROM vihem_companies WHERE organisation_id=org) ELSE '[]'::jsonb END,
 'clients',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.name),'[]') FROM vihem_snow_clients c WHERE c.organisation_id=org),
 'competencies',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') FROM vihem_snow_competencies c WHERE c.organisation_id=org AND (admin OR c.user_id=auth.uid())),
 'patterns',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.weekday),'[]') FROM vihem_snow_patterns p WHERE p.organisation_id=org AND (admin OR p.user_id=auth.uid())),
 'pattern_revisions',(SELECT coalesce(jsonb_object_agg(user_id,revision),'{}') FROM (SELECT user_id,md5(jsonb_agg(to_jsonb(p) ORDER BY weekday)::text) revision FROM vihem_snow_patterns p WHERE organisation_id=org AND (admin OR user_id=auth.uid()) GROUP BY user_id) x),
 'confirmations',(SELECT coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('current',NOT EXISTS(SELECT 1 FROM vihem_snow_patterns WHERE organisation_id=org AND user_id=c.user_id AND updated_at>c.confirmed_at) AND NOT EXISTS(SELECT 1 FROM vihem_snow_availability WHERE organisation_id=org AND user_id=c.user_id AND work_date BETWEEN c.week_start AND c.week_start+6 AND updated_at>c.confirmed_at))),'[]') FROM vihem_snow_week_confirmations c WHERE c.organisation_id=org AND c.week_start BETWEEN p_from-6 AND greatest(last_day,p_from+21) AND (admin OR c.user_id=auth.uid())),
 'duties',(SELECT coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('candidates',CASE WHEN admin THEN (SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM vihem_snow_candidates(d.id) x) ELSE '[]'::jsonb END) ORDER BY d.starts_at),'[]') FROM vihem_snow_duties d WHERE d.organisation_id=org AND d.starts_at<(last_day::timestamp AT TIME ZONE 'Europe/Stockholm') AND d.ends_at>(p_from::timestamp AT TIME ZONE 'Europe/Stockholm') AND (admin OR d.planned_user=auth.uid() OR d.accepted_user=auth.uid() OR EXISTS(SELECT 1 FROM vihem_snow_invitations i WHERE i.duty_id=d.id AND i.user_id=auth.uid()))),
 'invitations',(SELECT coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('push_status',coalesce((SELECT CASE WHEN count(pd.notification_id)=0 THEN 'not_confirmed' WHEN bool_or(pd.status='sent') THEN 'provider_accepted' WHEN bool_or(pd.status='unknown') THEN 'unknown' ELSE 'failed' END FROM vihem_snow_notices n JOIN vihem_push_deliveries pd ON pd.notification_id=n.notification_id WHERE n.object_id=i.id),'not_confirmed'))),'[]') FROM vihem_snow_invitations i JOIN vihem_snow_duties d ON d.id=i.duty_id WHERE i.organisation_id=org AND d.starts_at<(last_day::timestamp AT TIME ZONE 'Europe/Stockholm') AND d.ends_at>(p_from::timestamp AT TIME ZONE 'Europe/Stockholm') AND (admin OR i.user_id=auth.uid())),
 'entries',(SELECT coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('priced',EXISTS(SELECT 1 FROM vihem_snow_valuations WHERE entry_id=e.id AND fingerprint=vihem_snow_time_fingerprint(e)),'reserved',EXISTS(SELECT 1 FROM vihem_snow_invoice_entries WHERE entry_id=e.id),'valuation',CASE WHEN admin THEN (SELECT lines FROM vihem_snow_valuations WHERE entry_id=e.id) ELSE NULL END) ORDER BY e.start_time DESC),'[]') FROM vihem_time_entries e WHERE e.organisation_id=org AND e.snow_client_id IS NOT NULL AND e.entry_type='work' AND e.start_time>=(p_from::timestamp AT TIME ZONE 'Europe/Stockholm') AND e.start_time<(last_day::timestamp AT TIME ZONE 'Europe/Stockholm') AND (admin OR e.user_id=auth.uid())),
 'prices',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC),'[]') FROM vihem_snow_prices p WHERE p.organisation_id=org),
 'batches',CASE WHEN admin THEN (SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.created_at DESC),'[]') FROM vihem_snow_invoice_batches b WHERE b.organisation_id=org AND b.period_to>=p_from AND b.period_from<last_day) ELSE '[]'::jsonb END);
END$$;
CREATE FUNCTION public.vihem_snow_customers(p_query text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$BEGIN
 IF NOT vihem_snow_access() THEN RAISE EXCEPTION 'Snöåtkomst krävs' USING ERRCODE='42501';END IF;
 IF length(btrim(p_query)) NOT BETWEEN 2 AND 100 THEN RETURN '[]';END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (SELECT id,name,customer_type,email,phone,address_line1,postal_code,city,md5(to_jsonb(c)::text) revision FROM vihem_finance_customers c WHERE organisation_id=vihem_get_my_org_id() AND active AND position(lower(btrim(p_query)) IN lower(name))>0 ORDER BY name LIMIT 20) x);
END$$;
-- Extend the existing exact allowlist, preserving all older gates. No external accounts enabled.
DO $$DECLARE f text;needle text:='IF actor.snow_time_access THEN';BEGIN
 IF to_regprocedure('public.vihem_snow_api_guard()') IS NOT NULL THEN
  SELECT pg_get_functiondef('public.vihem_snow_api_guard()'::regprocedure) INTO f;
  IF position(needle IN f)=0 THEN RAISE EXCEPTION 'API-skyddet har ändrats; granska innan installation';END IF;
  f:=replace(f,needle,needle||E'\n IF method=''POST'' AND path IN (''/rpc/vihem_snow_board'',''/rpc/vihem_snow_command'',''/rpc/vihem_snow_clock'',''/rpc/vihem_snow_customers'',''/rpc/vihem_snow_add_item'') THEN RETURN;END IF;\n IF path=''/vihem_push_tokens'' AND method IN (''GET'',''HEAD'',''POST'',''PATCH'') THEN RETURN;END IF;');EXECUTE f;
 END IF;
END$$;
-- Existing restrictive snow-role policies otherwise block native push-token registration.
DO $$BEGIN IF to_regclass('public.vihem_push_tokens') IS NOT NULL THEN
 DROP POLICY IF EXISTS snow_external_read_gate ON public.vihem_push_tokens;
 DROP POLICY IF EXISTS snow_external_write_gate ON public.vihem_push_tokens;
 CREATE POLICY snow_external_read_gate ON public.vihem_push_tokens AS RESTRICTIVE FOR SELECT TO authenticated USING(vihem_get_my_role()<>'snow' OR (user_id=auth.uid() AND organisation_id=vihem_get_my_org_id() AND vihem_snow_access()));
 CREATE POLICY snow_external_write_gate ON public.vihem_push_tokens AS RESTRICTIVE FOR ALL TO authenticated USING(vihem_get_my_role()<>'snow' OR (user_id=auth.uid() AND organisation_id=vihem_get_my_org_id() AND vihem_snow_access())) WITH CHECK(vihem_get_my_role()<>'snow' OR (user_id=auth.uid() AND organisation_id=vihem_get_my_org_id() AND vihem_snow_access()));
 END IF;END$$;
REVOKE ALL ON FUNCTION public.vihem_snow_board(date,int),public.vihem_snow_customers(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vihem_snow_board(date,int),public.vihem_snow_customers(text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
