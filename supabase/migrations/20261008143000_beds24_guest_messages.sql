BEGIN;

CREATE TABLE public.vihem_short_stay_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.vihem_short_stay_units(id) ON DELETE CASCADE,
  beds24_message_id text NOT NULL,
  beds24_booking_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('guest', 'host', 'internalNote', 'system')),
  message text NOT NULL DEFAULT '',
  sent_at timestamptz NOT NULL,
  beds24_read boolean,
  attachment_name text,
  attachment_mime_type text,
  attachment_base64 text,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, beds24_message_id)
);
CREATE INDEX vihem_short_stay_messages_thread ON public.vihem_short_stay_messages (organisation_id, beds24_booking_id, sent_at);
CREATE INDEX vihem_short_stay_messages_recent ON public.vihem_short_stay_messages (organisation_id, sent_at DESC);
ALTER TABLE public.vihem_short_stay_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read guest conversations in their organisation"
  ON public.vihem_short_stay_messages FOR SELECT TO authenticated
  USING (organisation_id = public.vihem_get_my_org_id() AND public.is_short_stay_enabled(organisation_id) AND public.vihem_get_my_role() = ANY (ARRAY['admin','superadmin','staff']));
CREATE POLICY "Service manages guest conversation mirror"
  ON public.vihem_short_stay_messages FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.vihem_short_stay_messages FROM anon, authenticated;
GRANT SELECT ON public.vihem_short_stay_messages TO authenticated;
GRANT ALL ON public.vihem_short_stay_messages TO service_role;

CREATE VIEW public.vihem_short_stay_message_threads WITH (security_invoker = true) AS
SELECT DISTINCT ON (m.organisation_id, m.beds24_booking_id)
  m.organisation_id, m.beds24_booking_id, m.unit_id, m.message AS last_message,
  m.sent_at AS last_message_at, m.source AS last_source,
  count(*) OVER (PARTITION BY m.organisation_id, m.beds24_booking_id) AS message_count,
  u.name AS unit_name, b.id AS booking_id, b.guest_name, b.channel_name, b.start_date, b.end_date
FROM public.vihem_short_stay_messages m
JOIN public.vihem_short_stay_units u ON u.id = m.unit_id AND u.organisation_id = m.organisation_id
LEFT JOIN LATERAL (
  SELECT id, guest_name, channel_name, start_date, end_date FROM public.vihem_short_stay_bookings
  WHERE organisation_id = m.organisation_id AND beds24_booking_id = m.beds24_booking_id
  ORDER BY created_at DESC LIMIT 1
) b ON true
ORDER BY m.organisation_id, m.beds24_booking_id, m.sent_at DESC, m.beds24_message_id DESC;
REVOKE ALL ON public.vihem_short_stay_message_threads FROM anon, authenticated;
GRANT SELECT ON public.vihem_short_stay_message_threads TO authenticated, service_role;

-- Reuse the existing internal sync secret without exposing it to the browser.
CREATE OR REPLACE FUNCTION public.vihem_trigger_beds24_message_sync()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net AS $$
DECLARE settings jsonb;
BEGIN
  SELECT value INTO settings FROM public.vihem_system_settings WHERE key = 'beds24_scheduled_sync';
  IF COALESCE((settings->>'enabled')::boolean, false) IS NOT TRUE OR COALESCE(settings->>'secret', '') = '' THEN RETURN; END IF;
  PERFORM net.http_post(
    url := regexp_replace(COALESCE(NULLIF(settings->>'function_url', ''), 'http://kong:8000/functions/v1/vihem-sync-beds24-bookings'), '/vihem-sync-beds24-bookings$', '/vihem-sync-beds24-messages'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-vihem-sync-secret', settings->>'secret'),
    body := '{"scheduled":true}'::jsonb,
    timeout_milliseconds := 120000
  );
END;
$$;
REVOKE ALL ON FUNCTION public.vihem_trigger_beds24_message_sync() FROM PUBLIC, anon, authenticated;
SELECT cron.schedule('vihem-beds24-messages-every-15-minutes', '7,22,37,52 * * * *', 'SELECT public.vihem_trigger_beds24_message_sync();');
NOTIFY pgrst, 'reload schema';
COMMIT;
