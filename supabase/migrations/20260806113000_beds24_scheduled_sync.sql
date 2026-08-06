CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE TABLE IF NOT EXISTS public.vihem_system_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vihem_system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages VI-HEM system settings" ON public.vihem_system_settings;
CREATE POLICY "Service role manages VI-HEM system settings"
  ON public.vihem_system_settings FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DO $$
DECLARE
  default_function_url text := 'http://kong:8000/functions/v1/vihem-sync-beds24-bookings';
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.vihem_system_settings
    WHERE key = 'beds24_scheduled_sync'
  ) THEN
    INSERT INTO public.vihem_system_settings (key, value)
    VALUES (
      'beds24_scheduled_sync',
      jsonb_build_object(
        'enabled', true,
        'interval_minutes', 15,
        'function_url', default_function_url,
        'secret', encode(gen_random_bytes(32), 'hex')
      )
    );
  ELSE
    UPDATE public.vihem_system_settings
    SET
      value = jsonb_set(
        jsonb_set(
          jsonb_set(
            value,
            '{enabled}',
            COALESCE(value->'enabled', 'true'::jsonb),
            true
          ),
          '{interval_minutes}',
          '15'::jsonb,
          true
        ),
        '{function_url}',
        to_jsonb(COALESCE(NULLIF(value->>'function_url', ''), default_function_url)),
        true
      ),
      updated_at = now()
    WHERE key = 'beds24_scheduled_sync';

    UPDATE public.vihem_system_settings
    SET
      value = jsonb_set(value, '{secret}', to_jsonb(encode(gen_random_bytes(32), 'hex')), true),
      updated_at = now()
    WHERE key = 'beds24_scheduled_sync'
      AND COALESCE(value->>'secret', '') = '';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.vihem_trigger_beds24_scheduled_sync()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net
AS $$
DECLARE
  settings jsonb;
  function_url text;
  sync_secret text;
BEGIN
  SELECT value
  INTO settings
  FROM public.vihem_system_settings
  WHERE key = 'beds24_scheduled_sync';

  IF COALESCE((settings->>'enabled')::boolean, false) IS NOT TRUE THEN
    RETURN;
  END IF;

  function_url := COALESCE(NULLIF(settings->>'function_url', ''), 'http://kong:8000/functions/v1/vihem-sync-beds24-bookings');
  sync_secret := settings->>'secret';

  IF COALESCE(sync_secret, '') = '' THEN
    RAISE WARNING 'Beds24 scheduled sync secret saknas.';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-vihem-sync-secret', sync_secret
    ),
    body := jsonb_build_object(
      'scheduled', true,
      'source', 'pg_cron',
      'time', now()
    ),
    timeout_milliseconds := 10000
  );
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'vihem-beds24-sync-every-15-minutes'
  ) THEN
    PERFORM cron.unschedule('vihem-beds24-sync-every-15-minutes');
  END IF;

  PERFORM cron.schedule(
    'vihem-beds24-sync-every-15-minutes',
    '*/15 * * * *',
    $job$
      SELECT public.vihem_trigger_beds24_scheduled_sync();
    $job$
  );
END $$;
