-- Meetings rebuild, Phase 1 (Fredagsmöte) -- part 1/4: series + segments.
--
-- A Friday meeting is one vihem_meeting_series row + three vihem_meetings
-- rows (segment_key owner/finance/staff, sharing series_id, ordered by
-- segment_order). Each segment is a first-class vihem_meetings row on
-- purpose: every existing sub-table (agenda items, decisions, action
-- items, protocol rows, object links) already keys off meeting_id, so a
-- segment needs zero schema changes there to work -- see the approved
-- plan at composed-kindling-lemur.md for the full reasoning.
--
-- previous_meeting_id (existing column) keeps meaning "same segment, prior
-- week" -- segment-to-segment handoff is a separate concern, handled by
-- vihem_meeting_handoffs in the next migration, never by this column.

CREATE TABLE IF NOT EXISTS public.vihem_meeting_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  template_group_key text NOT NULL,
  title text NOT NULL DEFAULT '',
  recurrence_rule text NOT NULL DEFAULT 'weekly:friday',
  series_week_date date NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Prevents creating two Friday series for the same organisation/template/week.
  UNIQUE (organisation_id, template_group_key, series_week_date)
);

CREATE INDEX IF NOT EXISTS idx_vihem_meeting_series_org ON public.vihem_meeting_series(organisation_id, series_week_date DESC);

ALTER TABLE public.vihem_meeting_series ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM org users can read meeting series" ON public.vihem_meeting_series;
CREATE POLICY "VIHEM org users can read meeting series" ON public.vihem_meeting_series
  FOR SELECT TO authenticated
  USING (vihem_get_my_role() = 'superadmin' OR organisation_id = vihem_get_my_org_id());

DROP POLICY IF EXISTS "VIHEM meeting managers can insert series" ON public.vihem_meeting_series;
CREATE POLICY "VIHEM meeting managers can insert series" ON public.vihem_meeting_series
  FOR INSERT TO authenticated
  WITH CHECK (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND (
      vihem_get_my_role() = 'admin'
      OR vihem_has_permission(auth.uid(), 'meeting.series.manage')
    ))
  );

DROP POLICY IF EXISTS "VIHEM meeting managers can update series" ON public.vihem_meeting_series;
CREATE POLICY "VIHEM meeting managers can update series" ON public.vihem_meeting_series
  FOR UPDATE TO authenticated
  USING (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND (
      vihem_get_my_role() = 'admin'
      OR vihem_has_permission(auth.uid(), 'meeting.series.manage')
    ))
  );

-- Segment-scoped participants with a role, distinct from the legacy flat
-- participant_ids uuid[] (kept untouched on vihem_meetings for
-- legacy/meetings-v2 compatibility -- this table is additive).
CREATE TABLE IF NOT EXISTS public.vihem_meeting_segment_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.vihem_meetings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.vihem_profiles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('leader','secretary','owner','finance','foreman','staff','screen')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_vihem_meeting_segment_participants_meeting ON public.vihem_meeting_segment_participants(meeting_id);
CREATE INDEX IF NOT EXISTS idx_vihem_meeting_segment_participants_user ON public.vihem_meeting_segment_participants(user_id);

ALTER TABLE public.vihem_meeting_segment_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM segment participants read own or admin" ON public.vihem_meeting_segment_participants;
CREATE POLICY "VIHEM segment participants read own or admin" ON public.vihem_meeting_segment_participants
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.vihem_meetings m
      WHERE m.id = meeting_id
        AND (vihem_get_my_role() = 'superadmin' OR (m.organisation_id = vihem_get_my_org_id() AND vihem_get_my_role() = 'admin'))
    )
  );

DROP POLICY IF EXISTS "VIHEM meeting managers can manage participants" ON public.vihem_meeting_segment_participants;
CREATE POLICY "VIHEM meeting managers can manage participants" ON public.vihem_meeting_segment_participants
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vihem_meetings m
      WHERE m.id = meeting_id
        AND (vihem_get_my_role() = 'superadmin' OR (m.organisation_id = vihem_get_my_org_id() AND (vihem_get_my_role() = 'admin' OR vihem_has_permission(auth.uid(), 'meeting.series.manage'))))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vihem_meetings m
      WHERE m.id = meeting_id
        AND (vihem_get_my_role() = 'superadmin' OR (m.organisation_id = vihem_get_my_org_id() AND (vihem_get_my_role() = 'admin' OR vihem_has_permission(auth.uid(), 'meeting.series.manage'))))
    )
  );

ALTER TABLE public.vihem_meetings
  ADD COLUMN IF NOT EXISTS series_id uuid REFERENCES public.vihem_meeting_series(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS segment_key text CHECK (segment_key IN ('owner','finance','staff')),
  ADD COLUMN IF NOT EXISTS segment_order smallint;

CREATE INDEX IF NOT EXISTS idx_vihem_meetings_series ON public.vihem_meetings(series_id, segment_order);

ALTER TABLE public.vihem_meeting_agenda_items
  ADD COLUMN IF NOT EXISTS note_tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sensitivity text NOT NULL DEFAULT 'normal' CHECK (sensitivity IN ('normal','sensitive')),
  ADD COLUMN IF NOT EXISTS time_budget_minutes int;

-- Versioned templates: three segment templates share a template_group_key
-- so they can be edited/versioned independently instead of one jsonb blob.
-- A meeting's agenda_items are copied from the template at creation time
-- (see the series-creation RPC in the next migration), never a live
-- reference -- editing a template never rewrites an already-started
-- meeting's agenda.
ALTER TABLE public.vihem_meeting_templates
  ADD COLUMN IF NOT EXISTS template_group_key text,
  ADD COLUMN IF NOT EXISTS segment_key text CHECK (segment_key IN ('owner','finance','staff')),
  ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_vihem_meeting_templates_group ON public.vihem_meeting_templates(organisation_id, template_group_key, segment_key, active);

NOTIFY pgrst, 'reload schema';
