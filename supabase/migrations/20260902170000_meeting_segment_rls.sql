-- Meetings rebuild, Phase 1 -- part 4/4: segment-aware RLS on shared
-- tables, applied carefully so legacy/meetings-v2 meetings (segment_key
-- IS NULL) keep exactly today's behaviour. The added condition is
-- strictly additive (OR'd onto the existing org-wide clause) and only
-- ever narrows access for meetings that actually have a segment_key set.
--
-- Pattern per table:
--   (segment_key IS NULL AND <existing org-wide condition>)
--   OR (segment_key IS NOT NULL AND (
--         vihem_has_permission(auth.uid(), 'meeting.segment.' || segment_key || '.view')
--         OR EXISTS (participant row for this meeting)
--         OR admin/superadmin
--      ))
--
-- Existing INSERT/UPDATE/DELETE policies on these tables were already
-- admin-only (staff had no write access at all, even in the legacy/v2
-- UIs) -- this migration also grants segment leaders/secretaries write
-- access to their OWN segment's rows, which is new capability, not a
-- narrowing, and only applies to segmented meetings.

-- vihem_meeting_agenda_items -----------------------------------------------
DROP POLICY IF EXISTS "VIHEM org users can read" ON public.vihem_meeting_agenda_items;
CREATE POLICY "VIHEM org users can read" ON public.vihem_meeting_agenda_items
  FOR SELECT TO authenticated
  USING (
    vihem_get_my_role() = 'superadmin'
    OR EXISTS (
      SELECT 1 FROM public.vihem_meetings m WHERE m.id = meeting_id AND (
        (m.segment_key IS NULL AND m.organisation_id = vihem_get_my_org_id())
        OR (m.segment_key IS NOT NULL AND m.organisation_id = vihem_get_my_org_id() AND (
          vihem_get_my_role() = 'admin'
          OR vihem_has_permission(auth.uid(), 'meeting.segment.' || m.segment_key || '.view')
          OR EXISTS (SELECT 1 FROM public.vihem_meeting_segment_participants p WHERE p.meeting_id = m.id AND p.user_id = auth.uid())
        ))
      )
    )
  );

DROP POLICY IF EXISTS "VIHEM meeting admins can insert" ON public.vihem_meeting_agenda_items;
CREATE POLICY "VIHEM meeting admins can insert" ON public.vihem_meeting_agenda_items
  FOR INSERT TO authenticated
  WITH CHECK (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND vihem_get_my_role() = 'admin')
    OR EXISTS (
      SELECT 1 FROM public.vihem_meetings m
      JOIN public.vihem_meeting_segment_participants p ON p.meeting_id = m.id AND p.user_id = auth.uid() AND p.role IN ('leader','secretary')
      WHERE m.id = meeting_id AND m.segment_key IS NOT NULL AND m.organisation_id = vihem_get_my_org_id()
    )
  );

DROP POLICY IF EXISTS "VIHEM meeting admins can update" ON public.vihem_meeting_agenda_items;
CREATE POLICY "VIHEM meeting admins can update" ON public.vihem_meeting_agenda_items
  FOR UPDATE TO authenticated
  USING (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND vihem_get_my_role() = 'admin')
    OR EXISTS (
      SELECT 1 FROM public.vihem_meetings m
      JOIN public.vihem_meeting_segment_participants p ON p.meeting_id = m.id AND p.user_id = auth.uid() AND p.role IN ('leader','secretary')
      WHERE m.id = meeting_id AND m.segment_key IS NOT NULL AND m.organisation_id = vihem_get_my_org_id()
    )
  )
  WITH CHECK (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND vihem_get_my_role() = 'admin')
    OR EXISTS (
      SELECT 1 FROM public.vihem_meetings m
      JOIN public.vihem_meeting_segment_participants p ON p.meeting_id = m.id AND p.user_id = auth.uid() AND p.role IN ('leader','secretary')
      WHERE m.id = meeting_id AND m.segment_key IS NOT NULL AND m.organisation_id = vihem_get_my_org_id()
    )
  );
-- DELETE stays admin-only (unchanged policy).

-- vihem_meeting_protocol_rows ----------------------------------------------
DROP POLICY IF EXISTS "VIHEM org users can read" ON public.vihem_meeting_protocol_rows;
CREATE POLICY "VIHEM org users can read" ON public.vihem_meeting_protocol_rows
  FOR SELECT TO authenticated
  USING (
    vihem_get_my_role() = 'superadmin'
    OR EXISTS (
      SELECT 1 FROM public.vihem_meetings m WHERE m.id = meeting_id AND (
        (m.segment_key IS NULL AND m.organisation_id = vihem_get_my_org_id())
        OR (m.segment_key IS NOT NULL AND m.organisation_id = vihem_get_my_org_id() AND (
          vihem_get_my_role() = 'admin'
          OR vihem_has_permission(auth.uid(), 'meeting.segment.' || m.segment_key || '.view')
          OR EXISTS (SELECT 1 FROM public.vihem_meeting_segment_participants p WHERE p.meeting_id = m.id AND p.user_id = auth.uid())
        ))
      )
    )
  );

DROP POLICY IF EXISTS "VIHEM meeting admins can insert" ON public.vihem_meeting_protocol_rows;
CREATE POLICY "VIHEM meeting admins can insert" ON public.vihem_meeting_protocol_rows
  FOR INSERT TO authenticated
  WITH CHECK (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND vihem_get_my_role() = 'admin')
    OR EXISTS (
      SELECT 1 FROM public.vihem_meetings m
      JOIN public.vihem_meeting_segment_participants p ON p.meeting_id = m.id AND p.user_id = auth.uid() AND p.role IN ('leader','secretary')
      WHERE m.id = meeting_id AND m.segment_key IS NOT NULL AND m.organisation_id = vihem_get_my_org_id()
    )
  );

DROP POLICY IF EXISTS "VIHEM meeting admins can update" ON public.vihem_meeting_protocol_rows;
CREATE POLICY "VIHEM meeting admins can update" ON public.vihem_meeting_protocol_rows
  FOR UPDATE TO authenticated
  USING (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND vihem_get_my_role() = 'admin')
    OR EXISTS (
      SELECT 1 FROM public.vihem_meetings m
      JOIN public.vihem_meeting_segment_participants p ON p.meeting_id = m.id AND p.user_id = auth.uid() AND p.role IN ('leader','secretary')
      WHERE m.id = meeting_id AND m.segment_key IS NOT NULL AND m.organisation_id = vihem_get_my_org_id()
    )
  )
  WITH CHECK (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND vihem_get_my_role() = 'admin')
    OR EXISTS (
      SELECT 1 FROM public.vihem_meetings m
      JOIN public.vihem_meeting_segment_participants p ON p.meeting_id = m.id AND p.user_id = auth.uid() AND p.role IN ('leader','secretary')
      WHERE m.id = meeting_id AND m.segment_key IS NOT NULL AND m.organisation_id = vihem_get_my_org_id()
    )
  );

-- vihem_meeting_decisions ---------------------------------------------------
DROP POLICY IF EXISTS "VIHEM org users can read" ON public.vihem_meeting_decisions;
CREATE POLICY "VIHEM org users can read" ON public.vihem_meeting_decisions
  FOR SELECT TO authenticated
  USING (
    vihem_get_my_role() = 'superadmin'
    OR EXISTS (
      SELECT 1 FROM public.vihem_meetings m WHERE m.id = meeting_id AND (
        (m.segment_key IS NULL AND m.organisation_id = vihem_get_my_org_id())
        OR (m.segment_key IS NOT NULL AND m.organisation_id = vihem_get_my_org_id() AND (
          vihem_get_my_role() = 'admin'
          OR vihem_has_permission(auth.uid(), 'meeting.segment.' || m.segment_key || '.view')
          OR EXISTS (SELECT 1 FROM public.vihem_meeting_segment_participants p WHERE p.meeting_id = m.id AND p.user_id = auth.uid())
        ))
      )
    )
  );

DROP POLICY IF EXISTS "VIHEM meeting admins can insert" ON public.vihem_meeting_decisions;
CREATE POLICY "VIHEM meeting admins can insert" ON public.vihem_meeting_decisions
  FOR INSERT TO authenticated
  WITH CHECK (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND vihem_get_my_role() = 'admin')
    OR EXISTS (
      SELECT 1 FROM public.vihem_meetings m
      JOIN public.vihem_meeting_segment_participants p ON p.meeting_id = m.id AND p.user_id = auth.uid() AND p.role IN ('leader','secretary')
      WHERE m.id = meeting_id AND m.segment_key IS NOT NULL AND m.organisation_id = vihem_get_my_org_id()
    )
  );

DROP POLICY IF EXISTS "VIHEM meeting admins can update" ON public.vihem_meeting_decisions;
CREATE POLICY "VIHEM meeting admins can update" ON public.vihem_meeting_decisions
  FOR UPDATE TO authenticated
  USING (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND vihem_get_my_role() = 'admin')
    OR EXISTS (
      SELECT 1 FROM public.vihem_meetings m
      JOIN public.vihem_meeting_segment_participants p ON p.meeting_id = m.id AND p.user_id = auth.uid() AND p.role IN ('leader','secretary')
      WHERE m.id = meeting_id AND m.segment_key IS NOT NULL AND m.organisation_id = vihem_get_my_org_id()
    )
  )
  WITH CHECK (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND vihem_get_my_role() = 'admin')
    OR EXISTS (
      SELECT 1 FROM public.vihem_meetings m
      JOIN public.vihem_meeting_segment_participants p ON p.meeting_id = m.id AND p.user_id = auth.uid() AND p.role IN ('leader','secretary')
      WHERE m.id = meeting_id AND m.segment_key IS NOT NULL AND m.organisation_id = vihem_get_my_org_id()
    )
  );

-- vihem_meeting_action_items -------------------------------------------------
DROP POLICY IF EXISTS "VIHEM org users can read" ON public.vihem_meeting_action_items;
CREATE POLICY "VIHEM org users can read" ON public.vihem_meeting_action_items
  FOR SELECT TO authenticated
  USING (
    vihem_get_my_role() = 'superadmin'
    OR EXISTS (
      SELECT 1 FROM public.vihem_meetings m WHERE m.id = meeting_id AND (
        (m.segment_key IS NULL AND m.organisation_id = vihem_get_my_org_id())
        OR (m.segment_key IS NOT NULL AND m.organisation_id = vihem_get_my_org_id() AND (
          vihem_get_my_role() = 'admin'
          OR vihem_has_permission(auth.uid(), 'meeting.segment.' || m.segment_key || '.view')
          OR EXISTS (SELECT 1 FROM public.vihem_meeting_segment_participants p WHERE p.meeting_id = m.id AND p.user_id = auth.uid())
        ))
      )
    )
  );

DROP POLICY IF EXISTS "VIHEM meeting admins can insert" ON public.vihem_meeting_action_items;
CREATE POLICY "VIHEM meeting admins can insert" ON public.vihem_meeting_action_items
  FOR INSERT TO authenticated
  WITH CHECK (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND vihem_get_my_role() = 'admin')
    OR EXISTS (
      SELECT 1 FROM public.vihem_meetings m
      JOIN public.vihem_meeting_segment_participants p ON p.meeting_id = m.id AND p.user_id = auth.uid() AND p.role IN ('leader','secretary')
      WHERE m.id = meeting_id AND m.segment_key IS NOT NULL AND m.organisation_id = vihem_get_my_org_id()
    )
  );

DROP POLICY IF EXISTS "VIHEM meeting admins can update" ON public.vihem_meeting_action_items;
CREATE POLICY "VIHEM meeting admins can update" ON public.vihem_meeting_action_items
  FOR UPDATE TO authenticated
  USING (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND vihem_get_my_role() = 'admin')
    OR EXISTS (
      SELECT 1 FROM public.vihem_meetings m
      JOIN public.vihem_meeting_segment_participants p ON p.meeting_id = m.id AND p.user_id = auth.uid() AND p.role IN ('leader','secretary')
      WHERE m.id = meeting_id AND m.segment_key IS NOT NULL AND m.organisation_id = vihem_get_my_org_id()
    )
  )
  WITH CHECK (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND vihem_get_my_role() = 'admin')
    OR EXISTS (
      SELECT 1 FROM public.vihem_meetings m
      JOIN public.vihem_meeting_segment_participants p ON p.meeting_id = m.id AND p.user_id = auth.uid() AND p.role IN ('leader','secretary')
      WHERE m.id = meeting_id AND m.segment_key IS NOT NULL AND m.organisation_id = vihem_get_my_org_id()
    )
  );

-- vihem_meeting_object_links -------------------------------------------------
DROP POLICY IF EXISTS "VIHEM org users can read" ON public.vihem_meeting_object_links;
CREATE POLICY "VIHEM org users can read" ON public.vihem_meeting_object_links
  FOR SELECT TO authenticated
  USING (
    vihem_get_my_role() = 'superadmin'
    OR EXISTS (
      SELECT 1 FROM public.vihem_meetings m WHERE m.id = meeting_id AND (
        (m.segment_key IS NULL AND m.organisation_id = vihem_get_my_org_id())
        OR (m.segment_key IS NOT NULL AND m.organisation_id = vihem_get_my_org_id() AND (
          vihem_get_my_role() = 'admin'
          OR vihem_has_permission(auth.uid(), 'meeting.segment.' || m.segment_key || '.view')
          OR EXISTS (SELECT 1 FROM public.vihem_meeting_segment_participants p WHERE p.meeting_id = m.id AND p.user_id = auth.uid())
        ))
      )
    )
  );

DROP POLICY IF EXISTS "VIHEM meeting admins can insert" ON public.vihem_meeting_object_links;
CREATE POLICY "VIHEM meeting admins can insert" ON public.vihem_meeting_object_links
  FOR INSERT TO authenticated
  WITH CHECK (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND vihem_get_my_role() = 'admin')
    OR EXISTS (
      SELECT 1 FROM public.vihem_meetings m
      JOIN public.vihem_meeting_segment_participants p ON p.meeting_id = m.id AND p.user_id = auth.uid() AND p.role IN ('leader','secretary')
      WHERE m.id = meeting_id AND m.segment_key IS NOT NULL AND m.organisation_id = vihem_get_my_org_id()
    )
  );

-- vihem_ai_suggestions: extend existing read policy with segment scoping ---
DROP POLICY IF EXISTS "VIHEM org users can read" ON public.vihem_ai_suggestions;
CREATE POLICY "VIHEM org users can read" ON public.vihem_ai_suggestions
  FOR SELECT TO authenticated
  USING (
    vihem_get_my_role() = 'superadmin'
    OR (
      -- Non-meeting-sourced suggestions (other features reusing this table) keep today's flat org-wide read.
      source_type <> 'meeting' AND organisation_id = vihem_get_my_org_id()
    )
    OR (
      source_type = 'meeting' AND EXISTS (
        SELECT 1 FROM public.vihem_meetings m WHERE m.id = source_id AND (
          (m.segment_key IS NULL AND m.organisation_id = vihem_get_my_org_id())
          OR (m.segment_key IS NOT NULL AND m.organisation_id = vihem_get_my_org_id() AND (
            vihem_get_my_role() = 'admin'
            OR vihem_has_permission(auth.uid(), 'meeting.segment.' || m.segment_key || '.view')
            OR EXISTS (SELECT 1 FROM public.vihem_meeting_segment_participants p WHERE p.meeting_id = m.id AND p.user_id = auth.uid())
          ))
        )
      )
    )
  );

-- Allow meeting.ai.review holders (not just admin) to reject/postpone a
-- suggestion directly -- approval/apply always goes through the atomic
-- RPC (service role, see vihem-meeting-ai-apply), never this policy. The
-- WITH CHECK below deliberately restricts the non-admin branch to only
-- ever set status to rejected/postponed/needs_input -- it can NEVER move a
-- row to approved/applying/applied/conflict through a plain client UPDATE,
-- closing off the exact bypass the atomic-conflict-check requirement
-- exists to prevent.
DROP POLICY IF EXISTS "VIHEM meeting admins can update" ON public.vihem_ai_suggestions;
CREATE POLICY "VIHEM meeting admins can update" ON public.vihem_ai_suggestions
  FOR UPDATE TO authenticated
  USING (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND vihem_get_my_role() = 'admin')
    OR (
      source_type = 'meeting' AND EXISTS (
        SELECT 1 FROM public.vihem_meetings m
        WHERE m.id = source_id AND m.organisation_id = vihem_get_my_org_id()
          AND (vihem_has_permission(auth.uid(), 'meeting.ai.review') OR vihem_has_permission(auth.uid(), 'meeting.ai.apply'))
      )
    )
  )
  WITH CHECK (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND vihem_get_my_role() = 'admin')
    OR (
      source_type = 'meeting'
      AND status IN ('rejected','postponed','needs_input')
      AND EXISTS (
        SELECT 1 FROM public.vihem_meetings m
        WHERE m.id = source_id AND m.organisation_id = vihem_get_my_org_id()
          AND (vihem_has_permission(auth.uid(), 'meeting.ai.review') OR vihem_has_permission(auth.uid(), 'meeting.ai.apply'))
      )
    )
  );

NOTIFY pgrst, 'reload schema';
