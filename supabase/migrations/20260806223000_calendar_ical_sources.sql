ALTER TABLE public.vihem_calendar_events
  ADD COLUMN IF NOT EXISTS calendar_source_id uuid,
  ADD COLUMN IF NOT EXISTS external_uid text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS public.vihem_calendar_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.vihem_profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  ical_url text NOT NULL,
  color text NOT NULL DEFAULT '#2563eb',
  category text NOT NULL DEFAULT 'staff' CHECK (category IN ('general', 'operations', 'staff', 'maintenance', 'customer_project', 'short_stay', 'meeting', 'deadline', 'private')),
  active boolean NOT NULL DEFAULT true,
  last_synced_at timestamptz,
  sync_error text,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vihem_calendar_events_source_uid_unique'
  ) THEN
    ALTER TABLE public.vihem_calendar_events
      ADD CONSTRAINT vihem_calendar_events_source_uid_unique UNIQUE (calendar_source_id, external_uid);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vihem_calendar_events_calendar_source_id_fkey'
  ) THEN
    ALTER TABLE public.vihem_calendar_events
      ADD CONSTRAINT vihem_calendar_events_calendar_source_id_fkey
      FOREIGN KEY (calendar_source_id)
      REFERENCES public.vihem_calendar_sources(id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_vihem_calendar_sources_org_user
  ON public.vihem_calendar_sources(organisation_id, user_id);

CREATE INDEX IF NOT EXISTS idx_vihem_calendar_events_calendar_source
  ON public.vihem_calendar_events(calendar_source_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.vihem_calendar_sources;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.vihem_calendar_sources
  FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at();

ALTER TABLE public.vihem_calendar_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM calendar sources readable by staff" ON public.vihem_calendar_sources;
CREATE POLICY "VIHEM calendar sources readable by staff"
  ON public.vihem_calendar_sources
  FOR SELECT
  TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_get_my_role() IN ('staff', 'admin')
      AND (public.vihem_get_my_role() = 'admin' OR user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "VIHEM calendar sources manageable by admins" ON public.vihem_calendar_sources;
CREATE POLICY "VIHEM calendar sources manageable by admins"
  ON public.vihem_calendar_sources
  FOR ALL
  TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_get_my_role() = 'admin'
    )
  )
  WITH CHECK (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_get_my_role() = 'admin'
    )
  );

DROP POLICY IF EXISTS "VIHEM calendar source events service managed" ON public.vihem_calendar_events;
CREATE POLICY "VIHEM calendar source events service managed"
  ON public.vihem_calendar_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
