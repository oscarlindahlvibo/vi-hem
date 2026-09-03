-- Meetings rebuild -- replaces the pairing-code screen mechanism (deemed
-- unnecessary: VI-HEM already has a screen system where a physical screen
-- is a logged-in role='screen' account picking a named screen_key) with a
-- simple override: the leader control view flips a named screen (from the
-- org's existing vihem_screen_settings rows) to show a meeting segment,
-- and back again -- no separate pairing/login/edge-function layer needed.
--
-- Design: an override row is purely additive on top of a screen's normal
-- configured view. ScreenDisplayPage checks for one and, if present,
-- renders the segment view instead of whatever the screen's own
-- screen_view says. Deleting the row is the entire "revert to normal
-- display" action -- no previous-state bookkeeping needed. Auto-revert on
-- "avsluta delmöte" is just deleting any override rows for that meeting_id.

DROP TABLE IF EXISTS public.vihem_meeting_screen_sessions;

CREATE TABLE IF NOT EXISTS public.vihem_meeting_screen_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  screen_key text NOT NULL,
  meeting_id uuid NOT NULL REFERENCES public.vihem_meetings(id) ON DELETE CASCADE,
  segment_key text NOT NULL CHECK (segment_key IN ('owner','finance','staff')),
  display_mode text NOT NULL DEFAULT 'meeting_main' CHECK (display_mode IN ('meeting_main','staff_week_plan')),
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, screen_key)
);

CREATE INDEX IF NOT EXISTS idx_vihem_meeting_screen_overrides_meeting ON public.vihem_meeting_screen_overrides(meeting_id);

ALTER TABLE public.vihem_meeting_screen_overrides ENABLE ROW LEVEL SECURITY;

-- Same read audience as vihem_screen_settings itself (screens/staff/admin
-- in the org) -- the physical screen needs to read this to know whether
-- to show a meeting instead of its normal view.
DROP POLICY IF EXISTS "VIHEM org members can read screen overrides" ON public.vihem_meeting_screen_overrides;
CREATE POLICY "VIHEM org members can read screen overrides" ON public.vihem_meeting_screen_overrides
  FOR SELECT TO authenticated
  USING (organisation_id = get_my_org_id() AND get_my_role() = ANY (ARRAY['screen','staff','admin','superadmin']));

DROP POLICY IF EXISTS "VIHEM meeting leaders manage screen overrides" ON public.vihem_meeting_screen_overrides;
CREATE POLICY "VIHEM meeting leaders manage screen overrides" ON public.vihem_meeting_screen_overrides
  FOR ALL TO authenticated
  USING (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND (
      vihem_get_my_role() = 'admin'
      OR vihem_has_permission(auth.uid(), 'meeting.screen.manage')
    ))
  )
  WITH CHECK (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND (
      vihem_get_my_role() = 'admin'
      OR vihem_has_permission(auth.uid(), 'meeting.screen.manage')
    ))
  );

NOTIFY pgrst, 'reload schema';
