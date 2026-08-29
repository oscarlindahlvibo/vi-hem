-- Native push notifications were only half-built: the app registers the
-- device's APNs/FCM token and saves it to vihem_push_tokens (see
-- src/lib/nativePush.ts, migration 20260811120000), but nothing ever reads
-- that table to actually send a push -- vihem_notifications rows were
-- created (chat, work orders, inspections, fleet, scheduled reminders, ...)
-- and only ever shown in the in-app notification tab.
--
-- Fix: an AFTER INSERT trigger on vihem_notifications calls the new
-- vihem-send-push edge function via pg_net for every single row, regardless
-- of which feature created it -- so "everything in the notification tab
-- also becomes a phone notification" holds without having to remember to
-- wire push into each insert call site individually. Same
-- shared-secret-in-vihem_system_settings pattern already used by
-- vihem-accounted-healthcheck (20260822090000) and the beds24/Gmail
-- scheduled jobs, just fired per-row instead of on a cron schedule.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_net;

INSERT INTO public.vihem_system_settings(key, value)
VALUES ('push_notification_dispatch', jsonb_build_object(
  'enabled', true,
  'function_url', 'http://kong:8000/functions/v1/vihem-send-push',
  'secret', encode(gen_random_bytes(24), 'hex')
))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.vihem_dispatch_push_on_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net
AS $$
DECLARE
  cfg jsonb;
BEGIN
  SELECT value INTO cfg FROM public.vihem_system_settings WHERE key = 'push_notification_dispatch';

  IF cfg IS NULL OR COALESCE((cfg->>'enabled')::boolean, false) IS NOT TRUE
     OR COALESCE(cfg->>'function_url', '') = '' OR COALESCE(cfg->>'secret', '') = '' THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := cfg->>'function_url',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-VIHEM-Push-Secret', cfg->>'secret'
    ),
    body := jsonb_build_object('notification_id', NEW.id),
    timeout_milliseconds := 10000
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vihem_dispatch_push_on_notification ON public.vihem_notifications;
CREATE TRIGGER trg_vihem_dispatch_push_on_notification
  AFTER INSERT ON public.vihem_notifications
  FOR EACH ROW EXECUTE FUNCTION public.vihem_dispatch_push_on_notification();
