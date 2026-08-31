-- vihem-dispatch-scheduled-notifications/index.ts already implements the
-- shift-start/lunch-start/lunch-return/shift-end reminders (reads
-- vihem_staff_work_schedules, checks current time against a 5-minute
-- window, dedupes via vihem_notification_delivery_log) but nothing has
-- ever invoked it -- no cron.schedule() entry exists. Wire it up the same
-- way as the other scheduled edge functions (accounted-healthcheck,
-- push-dispatch): a secret stored in vihem_system_settings, a SECURITY
-- DEFINER trigger function calling it via pg_net with that secret in a
-- header, and a cron.schedule() entry running on the same 5-minute
-- cadence the function itself checks.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

INSERT INTO public.vihem_system_settings(key, value)
VALUES ('scheduled_notifications_dispatch', jsonb_build_object(
  'enabled', true,
  'function_url', 'http://kong:8000/functions/v1/vihem-dispatch-scheduled-notifications',
  'secret', encode(gen_random_bytes(24), 'hex')
))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.vihem_trigger_scheduled_notifications_dispatch()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net
AS $$
DECLARE
  cfg jsonb;
BEGIN
  SELECT value INTO cfg FROM public.vihem_system_settings WHERE key = 'scheduled_notifications_dispatch';

  IF cfg IS NULL OR COALESCE((cfg->>'enabled')::boolean, false) IS NOT TRUE
     OR COALESCE(cfg->>'function_url', '') = '' OR COALESCE(cfg->>'secret', '') = '' THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := cfg->>'function_url',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', cfg->>'secret'
    ),
    body := jsonb_build_object('scheduled', true, 'source', 'pg_cron', 'time', now()),
    timeout_milliseconds := 15000
  );
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vihem-scheduled-notifications-every-5-minutes') THEN
    PERFORM cron.unschedule('vihem-scheduled-notifications-every-5-minutes');
  END IF;

  PERFORM cron.schedule(
    'vihem-scheduled-notifications-every-5-minutes',
    '*/5 * * * *',
    $job$
      SELECT public.vihem_trigger_scheduled_notifications_dispatch();
    $job$
  );
END $$;
