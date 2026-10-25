BEGIN;
ALTER TABLE public.vihem_personal_reminder_deliveries ADD COLUMN push_attempts integer NOT NULL DEFAULT 1;
ALTER TABLE public.vihem_personal_reminder_deliveries ADD COLUMN last_push_at timestamptz NOT NULL DEFAULT now();
-- Uses the shared dispatcher and its per-device idempotency ledger.
-- Unknown provider outcomes are not blindly retried; the in-app reminder remains.
CREATE FUNCTION public.vihem_personal_retry_push() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d record; cfg jsonb; n integer:=0;
BEGIN
 SELECT value INTO cfg FROM vihem_system_settings WHERE key='push_notification_dispatch';
 IF NOT coalesce((cfg->>'enabled')::boolean,false) OR coalesce(cfg->>'function_url','')='' OR coalesce(cfg->>'secret','')='' THEN RETURN 0; END IF;
 FOR d IN SELECT dl.id,dl.notification_id FROM vihem_personal_reminder_deliveries dl
 JOIN vihem_personal_reminders r ON r.id=dl.reminder_id AND r.owner_id=dl.owner_id AND r.due_at=dl.due_at
 JOIN vihem_profiles p ON p.id=dl.owner_id AND p.active
 WHERE dl.notification_id IS NOT NULL AND dl.push_attempts<5 AND dl.last_push_at<now()-make_interval(mins=>power(2,dl.push_attempts)::integer)
 AND r.completed_at IS NULL AND r.cancelled_at IS NULL
 AND (r.note_id IS NULL OR EXISTS(SELECT 1 FROM vihem_personal_notes n WHERE n.id=r.note_id AND n.deleted_at IS NULL))
 AND NOT EXISTS(SELECT 1 FROM vihem_push_deliveries pd WHERE pd.notification_id=dl.notification_id AND pd.status IN ('pending','unknown'))
 AND (NOT EXISTS(SELECT 1 FROM vihem_push_deliveries pd WHERE pd.notification_id=dl.notification_id) OR EXISTS(SELECT 1 FROM vihem_push_deliveries pd WHERE pd.notification_id=dl.notification_id AND pd.status='failed'))
 ORDER BY dl.last_push_at LIMIT 100 FOR UPDATE OF dl SKIP LOCKED LOOP
  PERFORM net.http_post(url:=cfg->>'function_url',headers:=jsonb_build_object('Content-Type','application/json','X-VIHEM-Push-Secret',cfg->>'secret'),body:=jsonb_build_object('notification_id',d.notification_id),timeout_milliseconds:=10000);
  UPDATE vihem_personal_reminder_deliveries SET push_attempts=push_attempts+1,last_push_at=now() WHERE id=d.id;
  n:=n+1;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.vihem_personal_retry_push() FROM PUBLIC,authenticated,anon;
GRANT EXECUTE ON FUNCTION public.vihem_personal_retry_push() TO service_role;
COMMIT;
