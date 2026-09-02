-- Meetings rebuild, Phase 1 -- part 2/4: segment handoffs.
--
-- The three-field split (original_note / internal_explanation /
-- forwarded_text) is the mechanism that guarantees sensitive owner/finance
-- content never reaches the staff segment. The base table's RLS only ever
-- grants the SOURCE segment's participants SELECT on the full row
-- (including original_note/internal_explanation). The RECEIVING segment
-- reads exclusively through get_meeting_handoffs_for_segment(), a
-- SECURITY DEFINER function that hand-picks columns -- forwarded_text and
-- non-sensitive metadata only, never original_note/internal_explanation --
-- so the guarantee holds even if a view or a future query is written
-- carelessly against the base table. The function IS the security
-- boundary, not a view.

CREATE TABLE IF NOT EXISTS public.vihem_meeting_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  source_meeting_id uuid NOT NULL REFERENCES public.vihem_meetings(id) ON DELETE CASCADE,
  source_agenda_item_id uuid REFERENCES public.vihem_meeting_agenda_items(id) ON DELETE SET NULL,
  source_ai_suggestion_id uuid, -- FK added in the AI-runs migration (that table doesn't exist yet here)
  original_note text NOT NULL DEFAULT '',
  internal_explanation text NOT NULL DEFAULT '',
  forwarded_text text NOT NULL DEFAULT '',
  handoff_target text NOT NULL CHECK (handoff_target IN ('next_segment','later_meeting','separate_meeting','internal_follow_up_only','no_handoff')),
  target_meeting_id uuid REFERENCES public.vihem_meetings(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','acknowledged')),
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vihem_meeting_handoffs_source ON public.vihem_meeting_handoffs(source_meeting_id);
CREATE INDEX IF NOT EXISTS idx_vihem_meeting_handoffs_target ON public.vihem_meeting_handoffs(target_meeting_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.vihem_meeting_handoffs;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.vihem_meeting_handoffs
  FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at();

ALTER TABLE public.vihem_meeting_handoffs ENABLE ROW LEVEL SECURITY;

-- Only the SOURCE segment's participants (or org admin) can read the full
-- row -- this is deliberately the only SELECT policy on the base table.
-- The receiving segment never gets a base-table grant at all.
DROP POLICY IF EXISTS "VIHEM source segment can read own handoffs" ON public.vihem_meeting_handoffs;
CREATE POLICY "VIHEM source segment can read own handoffs" ON public.vihem_meeting_handoffs
  FOR SELECT TO authenticated
  USING (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND (
      vihem_get_my_role() = 'admin'
      OR EXISTS (SELECT 1 FROM public.vihem_meeting_segment_participants p WHERE p.meeting_id = source_meeting_id AND p.user_id = auth.uid())
    ))
  );

DROP POLICY IF EXISTS "VIHEM meeting leaders can create handoffs" ON public.vihem_meeting_handoffs;
CREATE POLICY "VIHEM meeting leaders can create handoffs" ON public.vihem_meeting_handoffs
  FOR INSERT TO authenticated
  WITH CHECK (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND (
      vihem_get_my_role() = 'admin'
      OR EXISTS (SELECT 1 FROM public.vihem_meeting_segment_participants p WHERE p.meeting_id = source_meeting_id AND p.user_id = auth.uid() AND p.role IN ('leader','secretary'))
    ))
  );

DROP POLICY IF EXISTS "VIHEM handoff approvers can update" ON public.vihem_meeting_handoffs;
CREATE POLICY "VIHEM handoff approvers can update" ON public.vihem_meeting_handoffs
  FOR UPDATE TO authenticated
  USING (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND (vihem_get_my_role() = 'admin' OR vihem_has_permission(auth.uid(), 'meeting.handoff.approve')))
  )
  WITH CHECK (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND (vihem_get_my_role() = 'admin' OR vihem_has_permission(auth.uid(), 'meeting.handoff.approve')))
  );

-- The receiving segment's ONLY path to this data. Deliberately narrow:
-- checks the caller has segment-read access to the handoff's own
-- target_meeting_id (not any meeting_id the caller supplies), and returns
-- a hand-picked column list.
CREATE OR REPLACE FUNCTION public.get_meeting_handoffs_for_segment(p_meeting_id uuid)
RETURNS TABLE (
  id uuid,
  forwarded_text text,
  handoff_target text,
  status text,
  source_meeting_id uuid,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_authorized boolean;
BEGIN
  SELECT m.organisation_id INTO v_org FROM public.vihem_meetings m WHERE m.id = p_meeting_id;
  IF v_org IS NULL THEN
    RETURN;
  END IF;

  v_authorized := (
    vihem_get_my_role() = 'superadmin'
    OR (v_org = vihem_get_my_org_id() AND (
      vihem_get_my_role() = 'admin'
      OR EXISTS (SELECT 1 FROM public.vihem_meeting_segment_participants p WHERE p.meeting_id = p_meeting_id AND p.user_id = auth.uid())
    ))
  );

  IF NOT v_authorized THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT h.id, h.forwarded_text, h.handoff_target, h.status, h.source_meeting_id, h.created_at
  FROM public.vihem_meeting_handoffs h
  WHERE h.target_meeting_id = p_meeting_id
    AND h.status IN ('delivered','acknowledged');
END;
$$;

REVOKE ALL ON FUNCTION public.get_meeting_handoffs_for_segment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_meeting_handoffs_for_segment(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
