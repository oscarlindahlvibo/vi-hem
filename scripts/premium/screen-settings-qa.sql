-- Isolated QA database only; all data/schema mutations roll back.
BEGIN;
DO $$ BEGIN IF current_database()<>'vihem_chat_qa' THEN RAISE EXCEPTION 'QA database required'; END IF; END $$;
CREATE TEMP TABLE screen_qa_context AS
 SELECT p.id, p.organisation_id FROM public.vihem_profiles p JOIN public.vihem_organisations o ON o.id=p.organisation_id
 WHERE o.name='VI-HEM Chat QA' AND p.role='admin' AND p.active LIMIT 1;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM screen_qa_context) THEN RAISE EXCEPTION 'QA admin missing'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM screen_qa_context),true);
DO $$
DECLARE expected jsonb; saved jsonb; original jsonb; config jsonb := '{"screens":[{"screen_key":"pass12-qa","name":"ÅÄÖ – Entré","screen_view":"presentation","presentation_settings":{},"meeting_part":"full"}]}';
BEGIN
 SELECT settings INTO original FROM vihem_organisations WHERE id=(SELECT organisation_id FROM screen_qa_context);
 expected := original->'screen_settings';
 saved := vihem_save_screen_settings(config,expected);
 IF saved-'screen_settings' IS DISTINCT FROM COALESCE(original,'{}'::jsonb)-'screen_settings' THEN RAISE EXCEPTION 'Unrelated settings lost'; END IF;
 IF NOT EXISTS(SELECT 1 FROM vihem_screen_settings WHERE organisation_id=(SELECT organisation_id FROM screen_qa_context) AND screen_key='pass12-qa' AND presentation_settings->>'screen_name'='ÅÄÖ – Entré') THEN RAISE EXCEPTION 'Screen not saved'; END IF;
 BEGIN PERFORM vihem_save_screen_settings(config || '{"screens":[]}',config); RAISE EXCEPTION 'Empty list accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM vihem_save_screen_settings(config,expected); -- identical replay
 BEGIN PERFORM vihem_save_screen_settings(jsonb_set(config,'{screens,0,name}','"Different"'),expected); RAISE EXCEPTION 'Stale write accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 BEGIN PERFORM vihem_save_screen_settings('{"screens":[{"screen_key":"foreign","name":"Other","screen_view":"laundry","laundry_room_id":"00000000-0000-0000-0000-000000000001","presentation_settings":{}}]}',config); RAISE EXCEPTION 'Foreign reference accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF (SELECT settings->'screen_settings' FROM vihem_organisations WHERE id=(SELECT organisation_id FROM screen_qa_context)) IS DISTINCT FROM config THEN RAISE EXCEPTION 'Invalid attempt changed configuration'; END IF;
END $$;
-- Inject failure AFTER screen upsert/deletion, proving the whole transaction rolls back.
CREATE FUNCTION pg_temp.screen_qa_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id=(SELECT organisation_id FROM screen_qa_context) THEN RAISE EXCEPTION 'QA injected failure' USING ERRCODE='P0002'; END IF; RETURN NEW; END $$;
CREATE TRIGGER screen_qa_failure BEFORE UPDATE ON public.vihem_organisations FOR EACH ROW EXECUTE FUNCTION pg_temp.screen_qa_fail();
DO $$ DECLARE expected jsonb; BEGIN
 SELECT settings->'screen_settings' INTO expected FROM vihem_organisations WHERE id=(SELECT organisation_id FROM screen_qa_context);
 BEGIN PERFORM vihem_save_screen_settings('{"screens":[{"screen_key":"fail","name":"Fail","screen_view":"presentation","presentation_settings":{}}]}',expected); RAISE EXCEPTION 'Injected failure missing'; EXCEPTION WHEN no_data_found THEN NULL; END;
 IF EXISTS(SELECT 1 FROM vihem_screen_settings WHERE screen_key='fail' AND organisation_id=(SELECT organisation_id FROM screen_qa_context)) OR NOT EXISTS(SELECT 1 FROM vihem_screen_settings WHERE screen_key='pass12-qa' AND organisation_id=(SELECT organisation_id FROM screen_qa_context)) THEN RAISE EXCEPTION 'Partial save'; END IF;
END $$;
DROP TRIGGER screen_qa_failure ON public.vihem_organisations;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM vihem_profiles WHERE organisation_id=(SELECT organisation_id FROM screen_qa_context) AND role='staff' AND active LIMIT 1),true);
DO $$ BEGIN BEGIN PERFORM vihem_save_screen_settings('{"screens":[]}',NULL); RAISE EXCEPTION 'Staff accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM vihem_profiles WHERE organisation_id=(SELECT organisation_id FROM screen_qa_context) AND role='tenant' AND active LIMIT 1),true);
DO $$ BEGIN BEGIN PERFORM vihem_save_screen_settings('{"screens":[]}',NULL); RAISE EXCEPTION 'Tenant accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM screen_qa_context),true);
UPDATE vihem_profiles SET active=false WHERE id=(SELECT id FROM screen_qa_context);
DO $$ BEGIN BEGIN PERFORM vihem_save_screen_settings('{"screens":[]}',NULL); RAISE EXCEPTION 'Inactive accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
SELECT set_config('request.jwt.claim.sub','',true);
DO $$ BEGIN BEGIN PERFORM vihem_save_screen_settings('{"screens":[]}',NULL); RAISE EXCEPTION 'Anonymous accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
ROLLBACK;
SELECT 'PASS: atomic screen save, Unicode, preserved integrations, stale/invalid/foreign references, rollback, staff/tenant/inactive/anonymous denial';
