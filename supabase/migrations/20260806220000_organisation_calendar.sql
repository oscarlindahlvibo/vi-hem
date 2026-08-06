CREATE TABLE IF NOT EXISTS public.vihem_calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  all_day boolean NOT NULL DEFAULT false,
  visibility text NOT NULL DEFAULT 'organisation' CHECK (visibility IN ('organisation', 'selected_users', 'private')),
  participant_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  category text NOT NULL DEFAULT 'general' CHECK (category IN ('general', 'operations', 'staff', 'maintenance', 'customer_project', 'short_stay', 'meeting', 'deadline', 'private')),
  color text NOT NULL DEFAULT '#2563eb',
  source_type text NOT NULL DEFAULT 'manual',
  source_id uuid,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_vihem_calendar_events_org_time
  ON public.vihem_calendar_events(organisation_id, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_vihem_calendar_events_participants
  ON public.vihem_calendar_events USING gin(participant_ids);

DROP TRIGGER IF EXISTS set_updated_at ON public.vihem_calendar_events;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.vihem_calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at();

ALTER TABLE public.vihem_calendar_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM calendar readable by relevant users" ON public.vihem_calendar_events;
CREATE POLICY "VIHEM calendar readable by relevant users"
  ON public.vihem_calendar_events
  FOR SELECT
  TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_get_my_role() IN ('staff', 'admin')
      AND (
        visibility = 'organisation'
        OR auth.uid() = created_by
        OR auth.uid() = ANY(participant_ids)
      )
    )
  );

DROP POLICY IF EXISTS "VIHEM staff can create calendar events" ON public.vihem_calendar_events;
CREATE POLICY "VIHEM staff can create calendar events"
  ON public.vihem_calendar_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_get_my_role() IN ('staff', 'admin')
      AND created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "VIHEM staff can update relevant calendar events" ON public.vihem_calendar_events;
CREATE POLICY "VIHEM staff can update relevant calendar events"
  ON public.vihem_calendar_events
  FOR UPDATE
  TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND (
        public.vihem_get_my_role() = 'admin'
        OR created_by = auth.uid()
        OR auth.uid() = ANY(participant_ids)
      )
    )
  )
  WITH CHECK (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND (
        public.vihem_get_my_role() = 'admin'
        OR created_by = auth.uid()
        OR auth.uid() = ANY(participant_ids)
      )
    )
  );

DROP POLICY IF EXISTS "VIHEM staff can delete relevant calendar events" ON public.vihem_calendar_events;
CREATE POLICY "VIHEM staff can delete relevant calendar events"
  ON public.vihem_calendar_events
  FOR DELETE
  TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND (
        public.vihem_get_my_role() = 'admin'
        OR created_by = auth.uid()
      )
    )
  );

NOTIFY pgrst, 'reload schema';
