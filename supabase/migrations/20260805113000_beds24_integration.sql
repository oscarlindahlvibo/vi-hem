-- Beds24 integration for VI-HEM short stay module

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.vihem_beds24_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE UNIQUE,
  enabled boolean NOT NULL DEFAULT false,
  refresh_token text NOT NULL DEFAULT '',
  access_token text NOT NULL DEFAULT '',
  access_token_expires_at timestamptz,
  webhook_secret text NOT NULL DEFAULT encode(gen_random_bytes(18), 'hex'),
  last_sync_at timestamptz,
  last_error text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.vihem_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vihem_beds24_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES public.vihem_beds24_connections(id) ON DELETE SET NULL,
  unit_id uuid REFERENCES public.vihem_short_stay_units(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'info' CHECK (status IN ('success', 'warning', 'error', 'info')),
  event_type text NOT NULL DEFAULT 'sync',
  message text NOT NULL DEFAULT '',
  imported_count integer NOT NULL DEFAULT 0,
  external_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vihem_short_stay_bookings
  ADD COLUMN IF NOT EXISTS beds24_booking_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS beds24_status text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_vihem_beds24_connections_org
  ON public.vihem_beds24_connections(organisation_id);

CREATE INDEX IF NOT EXISTS idx_vihem_beds24_sync_logs_org_created
  ON public.vihem_beds24_sync_logs(organisation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vihem_short_stay_bookings_beds24_id
  ON public.vihem_short_stay_bookings(beds24_booking_id)
  WHERE beds24_booking_id <> '';

ALTER TABLE public.vihem_beds24_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_beds24_sync_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages Beds24 connections" ON public.vihem_beds24_connections;
CREATE POLICY "Service role manages Beds24 connections"
  ON public.vihem_beds24_connections FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Org admins can read Beds24 logs" ON public.vihem_beds24_sync_logs;
CREATE POLICY "Org admins can read Beds24 logs"
  ON public.vihem_beds24_sync_logs FOR SELECT
  TO authenticated
  USING (
    organisation_id = public.get_my_org_id()
    AND public.get_my_role() = ANY (ARRAY['admin','superadmin'])
  );

DROP POLICY IF EXISTS "Service role manages Beds24 logs" ON public.vihem_beds24_sync_logs;
CREATE POLICY "Service role manages Beds24 logs"
  ON public.vihem_beds24_sync_logs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
