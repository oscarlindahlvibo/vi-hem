CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE TABLE IF NOT EXISTS public.vihem_mail_watch_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  name text NOT NULL,
  keywords text[] NOT NULL DEFAULT '{}',
  match_mode text NOT NULL DEFAULT 'any' CHECK (match_mode IN ('any', 'all')),
  enabled boolean NOT NULL DEFAULT true,
  account_ids uuid[] NOT NULL DEFAULT '{}',
  last_run_at timestamptz,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vihem_mail_watch_hits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES public.vihem_mail_watch_rules(id) ON DELETE CASCADE,
  mail_account_id uuid NOT NULL REFERENCES public.vihem_mail_accounts(id) ON DELETE CASCADE,
  gmail_message_id text NOT NULL,
  thread_id text,
  subject text NOT NULL DEFAULT '',
  from_address text NOT NULL DEFAULT '',
  message_date timestamptz,
  matched_keywords text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'seen', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, mail_account_id, gmail_message_id)
);

CREATE INDEX IF NOT EXISTS vihem_mail_watch_rules_org_idx ON public.vihem_mail_watch_rules(organisation_id, enabled);
CREATE INDEX IF NOT EXISTS vihem_mail_watch_hits_org_date_idx ON public.vihem_mail_watch_hits(organisation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vihem_mail_watch_hits_rule_idx ON public.vihem_mail_watch_hits(rule_id, message_date DESC);

ALTER TABLE public.vihem_mail_watch_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_mail_watch_hits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM mail watch rules read own org" ON public.vihem_mail_watch_rules;
CREATE POLICY "VIHEM mail watch rules read own org" ON public.vihem_mail_watch_rules
  FOR SELECT TO authenticated USING (organisation_id = public.get_my_org_id());
DROP POLICY IF EXISTS "VIHEM mail watch hits read own org" ON public.vihem_mail_watch_hits;
CREATE POLICY "VIHEM mail watch hits read own org" ON public.vihem_mail_watch_hits
  FOR SELECT TO authenticated USING (organisation_id = public.get_my_org_id());

ALTER TABLE public.vihem_mail_audit_events DROP CONSTRAINT IF EXISTS vihem_mail_audit_events_action_check;
ALTER TABLE public.vihem_mail_audit_events ADD CONSTRAINT vihem_mail_audit_events_action_check CHECK (action IN (
  'account_created', 'account_updated', 'account_deleted', 'connection_tested', 'search',
  'message_read', 'attachment_downloaded', 'attachment_linked', 'watch_rule_created', 'watch_rule_updated',
  'watch_rule_deleted', 'watch_run'
));

INSERT INTO public.vihem_system_settings(key, value)
VALUES ('gmail_watch_scheduled', jsonb_build_object(
  'enabled', true,
  'interval_hours', 24,
  'function_url', 'http://kong:8000/functions/v1/vihem-gmail',
  'secret', encode(gen_random_bytes(24), 'hex')
))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.vihem_trigger_gmail_watch()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net AS $$
DECLARE cfg jsonb;
BEGIN
  SELECT value INTO cfg FROM public.vihem_system_settings WHERE key = 'gmail_watch_scheduled';
  IF COALESCE((cfg->>'enabled')::boolean, false) AND COALESCE(cfg->>'function_url', '') <> '' THEN
    PERFORM net.http_post(
      url := cfg->>'function_url',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-vihem-gmail-watch-secret', cfg->>'secret'),
      body := jsonb_build_object('action', 'run_watchers', 'scheduled', true, 'source', 'pg_cron', 'time', now())
    );
  END IF;
END;
$$;

SELECT cron.unschedule('vihem-gmail-watch-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'vihem-gmail-watch-daily'
);
SELECT cron.schedule('vihem-gmail-watch-daily', '15 2 * * *', $$SELECT public.vihem_trigger_gmail_watch();$$);
