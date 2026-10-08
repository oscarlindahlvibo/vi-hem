/*
  # Fleet Manager: sparade informationskällor per fordon

  AI-tolkningen av ett fordon (länk till t.ex. biluppgifter.se / Transportstyrelsen)
  sparas nu tillsammans med länken. vihem-fleet-recheck-sources hämtar sidorna
  igen (dagligen via pg_cron, eller på begäran från fordonssidan), tolkar dem med
  AI och uppdaterar besiktningsdatum, så att man automatiskt ser om besiktning
  utförts och när nästa förfaller.
*/

CREATE TABLE IF NOT EXISTS public.vihem_fleet_vehicle_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vihem_fleet_vehicles(id) ON DELETE CASCADE,
  url text NOT NULL,
  label text NOT NULL DEFAULT '',
  auto_check boolean NOT NULL DEFAULT true,
  extracted jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_inspection_date date,
  next_inspection_date date,
  last_checked_at timestamptz,
  last_status text NOT NULL DEFAULT 'pending' CHECK (last_status IN ('pending','ok','error')),
  last_error text NOT NULL DEFAULT '',
  last_change_summary text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, url)
);
CREATE INDEX IF NOT EXISTS vihem_fleet_vehicle_sources_vehicle_idx ON public.vihem_fleet_vehicle_sources(vehicle_id);

ALTER TABLE public.vihem_fleet_vehicle_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Fleet vehicle sources read" ON public.vihem_fleet_vehicle_sources;
CREATE POLICY "Fleet vehicle sources read" ON public.vihem_fleet_vehicle_sources FOR SELECT TO authenticated
  USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_module_enabled('fleet_management'));
DROP POLICY IF EXISTS "Fleet vehicle sources admin write" ON public.vihem_fleet_vehicle_sources;
CREATE POLICY "Fleet vehicle sources admin write" ON public.vihem_fleet_vehicle_sources FOR ALL TO authenticated
  USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin','superadmin') AND public.vihem_module_enabled('fleet_management'))
  WITH CHECK (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin','superadmin') AND public.vihem_module_enabled('fleet_management'));

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

INSERT INTO public.vihem_system_settings(key, value)
VALUES ('fleet_source_recheck', jsonb_build_object(
  'enabled', true,
  'function_url', 'http://kong:8000/functions/v1/vihem-fleet-recheck-sources',
  'secret', encode(gen_random_bytes(24), 'hex')
))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.vihem_trigger_fleet_source_recheck()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net
AS $$
DECLARE
  cfg jsonb;
BEGIN
  SELECT value INTO cfg FROM public.vihem_system_settings WHERE key = 'fleet_source_recheck';
  IF cfg IS NULL OR COALESCE((cfg->>'enabled')::boolean, false) IS NOT TRUE
     OR COALESCE(cfg->>'function_url', '') = '' OR COALESCE(cfg->>'secret', '') = '' THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := cfg->>'function_url',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-vihem-fleet-recheck-secret', cfg->>'secret'),
    body := jsonb_build_object('scheduled', true, 'time', now()),
    timeout_milliseconds := 55000
  );
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vihem-fleet-source-recheck-daily') THEN
    PERFORM cron.unschedule('vihem-fleet-source-recheck-daily');
  END IF;
  PERFORM cron.schedule('vihem-fleet-source-recheck-daily', '40 4 * * *', $job$ SELECT public.vihem_trigger_fleet_source_recheck(); $job$);
END $$;
