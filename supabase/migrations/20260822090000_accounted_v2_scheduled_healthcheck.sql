/*
  # Accounted V2: proactive scheduled health check

  A broken Accounted connection (expired API key, network issue, wrong
  base URL) should surface on its own instead of waiting for an admin to
  notice invoices silently failing or to remember to click "Testa
  anslutning" in Bolagskoppling. pg_cron now calls a new edge function
  (vihem-accounted-healthcheck) every 30 minutes for every ENABLED company
  link, running the exact same check the manual button triggers (shared via
  runAccountedHealthCheck in _shared/accounted-company-context.ts) and
  writing the result to the same last_health_status/last_health_check_at/
  last_health_error columns the UI already reads.

  Same pattern as the existing beds24 (20260806113000) and Gmail watch
  (20260814120000) scheduled jobs: a per-feature row in the shared
  vihem_system_settings table carrying a generated secret, a SECURITY
  DEFINER trigger function that calls the edge function via pg_net with
  that secret in a custom header, and a cron.schedule() entry. Purely
  additive -- does not touch vihem_system_settings' own definition (already
  created by the beds24 migration) or any other scheduled job's row.
*/

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

INSERT INTO public.vihem_system_settings(key, value)
VALUES ('accounted_scheduled_healthcheck', jsonb_build_object(
  'enabled', true,
  'interval_minutes', 30,
  'function_url', 'http://kong:8000/functions/v1/vihem-accounted-healthcheck',
  'secret', encode(gen_random_bytes(24), 'hex')
))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.vihem_trigger_accounted_healthcheck()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net
AS $$
DECLARE
  cfg jsonb;
BEGIN
  SELECT value INTO cfg FROM public.vihem_system_settings WHERE key = 'accounted_scheduled_healthcheck';

  IF cfg IS NULL OR COALESCE((cfg->>'enabled')::boolean, false) IS NOT TRUE
     OR COALESCE(cfg->>'function_url', '') = '' OR COALESCE(cfg->>'secret', '') = '' THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := cfg->>'function_url',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-vihem-accounted-healthcheck-secret', cfg->>'secret'
    ),
    body := jsonb_build_object('scheduled', true, 'source', 'pg_cron', 'time', now()),
    timeout_milliseconds := 15000
  );
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vihem-accounted-healthcheck-every-30-minutes') THEN
    PERFORM cron.unschedule('vihem-accounted-healthcheck-every-30-minutes');
  END IF;

  PERFORM cron.schedule(
    'vihem-accounted-healthcheck-every-30-minutes',
    '*/30 * * * *',
    $job$
      SELECT public.vihem_trigger_accounted_healthcheck();
    $job$
  );
END $$;
