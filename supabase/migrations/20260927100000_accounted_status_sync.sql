/*
  # Accounted V2: scheduled invoice status sync (polling instead of webhooks)

  Accounted refuses webhook URLs that resolve to private addresses, and the
  self-hosted VI-HEM Supabase is only reachable on the LAN, so webhooks
  cannot be registered. Instead pg_cron calls vihem-accounted-status-sync
  every hour; it re-reads every not-yet-final invoice link from Accounted
  (same fields the webhook / manual refresh write).

  Also allows the new last_sync_source values 'send' (written by
  vihem-accounted-rent-billing after issuing an invoice) and 'poll'.
*/

ALTER TABLE public.vihem_accounted_invoice_links
  DROP CONSTRAINT IF EXISTS vihem_accounted_invoice_links_last_sync_source_check;
ALTER TABLE public.vihem_accounted_invoice_links
  ADD CONSTRAINT vihem_accounted_invoice_links_last_sync_source_check
  CHECK (last_sync_source IN ('create', 'webhook', 'manual_refresh', 'send', 'poll'));

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

INSERT INTO public.vihem_system_settings(key, value)
VALUES ('accounted_status_sync', jsonb_build_object(
  'enabled', true,
  'function_url', 'http://kong:8000/functions/v1/vihem-accounted-status-sync',
  'secret', encode(gen_random_bytes(24), 'hex')
))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.vihem_trigger_accounted_status_sync()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net
AS $$
DECLARE
  cfg jsonb;
BEGIN
  SELECT value INTO cfg FROM public.vihem_system_settings WHERE key = 'accounted_status_sync';

  IF cfg IS NULL OR COALESCE((cfg->>'enabled')::boolean, false) IS NOT TRUE
     OR COALESCE(cfg->>'function_url', '') = '' OR COALESCE(cfg->>'secret', '') = '' THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := cfg->>'function_url',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-vihem-accounted-status-sync-secret', cfg->>'secret'
    ),
    body := jsonb_build_object('scheduled', true, 'source', 'pg_cron', 'time', now()),
    timeout_milliseconds := 55000
  );
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vihem-accounted-status-sync-hourly') THEN
    PERFORM cron.unschedule('vihem-accounted-status-sync-hourly');
  END IF;
  PERFORM cron.schedule(
    'vihem-accounted-status-sync-hourly',
    '7 * * * *',
    $job$ SELECT public.vihem_trigger_accounted_status_sync(); $job$
  );
END $$;
