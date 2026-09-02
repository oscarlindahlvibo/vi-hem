-- Meetings rebuild, Phase 1 -- part 3/4: AI runs, review-queue extensions,
-- screen pairing sessions, week-plan board, missing-documents tracking.

-- Frozen snapshot per AI analysis run, tracked separately from individual
-- vihem_ai_suggestions rows so "AI analysis of segment X at time Y produced
-- N suggestions" is itself a real, trackable, immutable record (the
-- snapshot is never updated after status leaves 'running'; a later
-- analysis creates a NEW run row instead of overwriting this one).
CREATE TABLE IF NOT EXISTS public.vihem_meeting_ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.vihem_meetings(id) ON DELETE CASCADE,
  triggered_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_used text NOT NULL DEFAULT '',
  error_message text,
  suggestion_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_vihem_meeting_ai_runs_meeting ON public.vihem_meeting_ai_runs(meeting_id, created_at DESC);

ALTER TABLE public.vihem_meeting_ai_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM segment participants read ai runs" ON public.vihem_meeting_ai_runs;
CREATE POLICY "VIHEM segment participants read ai runs" ON public.vihem_meeting_ai_runs
  FOR SELECT TO authenticated
  USING (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND (
      vihem_get_my_role() = 'admin'
      OR EXISTS (SELECT 1 FROM public.vihem_meeting_segment_participants p WHERE p.meeting_id = vihem_meeting_ai_runs.meeting_id AND p.user_id = auth.uid())
    ))
  );

-- Writes to this table only ever happen from the vihem-meeting-ai edge
-- function using the service role, which bypasses RLS -- no INSERT/UPDATE
-- policy is granted to regular authenticated users at all.

-- Screen pairing sessions: read-only, expiring, meeting-segment-scoped,
-- no Supabase Auth login required on the physical screen. Only hashes are
-- stored for both the pairing code and the session token -- see
-- vihem-meeting-screen-pair/vihem-meeting-screen-data for the actual
-- issuance/redemption logic. RLS here only lets the meeting's own
-- participants/admins manage sessions from the leader control view; the
-- paired screen itself never authenticates as a Postgres role at all, so
-- it never touches these RLS policies -- its access is entirely mediated
-- by the vihem-meeting-screen-data edge function (service role internally,
-- hand-picked response fields, the real security boundary for that path).
CREATE TABLE IF NOT EXISTS public.vihem_meeting_screen_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.vihem_meetings(id) ON DELETE CASCADE,
  segment_key text NOT NULL CHECK (segment_key IN ('owner','finance','staff')),
  display_role text NOT NULL CHECK (display_role IN ('meeting_main','staff_week_plan')),
  screen_setting_id uuid REFERENCES public.vihem_screen_settings(id) ON DELETE SET NULL,
  label text NOT NULL DEFAULT '',
  pairing_code_hash text NOT NULL,
  pairing_code_redeemed_at timestamptz,
  redeem_attempts int NOT NULL DEFAULT 0,
  session_token_hash text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked','expired')),
  pairing_expires_at timestamptz NOT NULL,
  session_expires_at timestamptz,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  revoked_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vihem_meeting_screen_sessions_meeting ON public.vihem_meeting_screen_sessions(meeting_id);

ALTER TABLE public.vihem_meeting_screen_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM meeting leaders manage screen sessions" ON public.vihem_meeting_screen_sessions;
CREATE POLICY "VIHEM meeting leaders manage screen sessions" ON public.vihem_meeting_screen_sessions
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

-- Simple, real (not a shadow copy) planning-board table for the staff
-- segment's second screen. Rows link back to a real work order / customer
-- project when one exists; the board itself is the mötesspecifika surface,
-- not a duplicate source of truth.
CREATE TABLE IF NOT EXISTS public.vihem_meeting_week_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  series_id uuid REFERENCES public.vihem_meeting_series(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.vihem_meetings(id) ON DELETE CASCADE,
  work_order_id uuid REFERENCES public.vihem_work_orders(id) ON DELETE SET NULL,
  customer_project_id uuid REFERENCES public.vihem_customer_projects(id) ON DELETE SET NULL,
  title text NOT NULL,
  responsible_user_id uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  participant_user_ids uuid[] NOT NULL DEFAULT '{}',
  planned_date date,
  deadline date,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','blocked','done')),
  material_needed text NOT NULL DEFAULT '',
  blockers text NOT NULL DEFAULT '',
  highlighted boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vihem_meeting_week_plan_items_meeting ON public.vihem_meeting_week_plan_items(meeting_id, sort_order);

DROP TRIGGER IF EXISTS set_updated_at ON public.vihem_meeting_week_plan_items;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.vihem_meeting_week_plan_items
  FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at();

ALTER TABLE public.vihem_meeting_week_plan_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM staff segment can read week plan" ON public.vihem_meeting_week_plan_items;
CREATE POLICY "VIHEM staff segment can read week plan" ON public.vihem_meeting_week_plan_items
  FOR SELECT TO authenticated
  USING (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND (
      vihem_get_my_role() = 'admin'
      OR EXISTS (SELECT 1 FROM public.vihem_meeting_segment_participants p WHERE p.meeting_id = vihem_meeting_week_plan_items.meeting_id AND p.user_id = auth.uid())
    ))
  );

DROP POLICY IF EXISTS "VIHEM meeting leaders manage week plan" ON public.vihem_meeting_week_plan_items;
CREATE POLICY "VIHEM meeting leaders manage week plan" ON public.vihem_meeting_week_plan_items
  FOR ALL TO authenticated
  USING (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND (
      vihem_get_my_role() = 'admin'
      OR EXISTS (SELECT 1 FROM public.vihem_meeting_segment_participants p WHERE p.meeting_id = vihem_meeting_week_plan_items.meeting_id AND p.user_id = auth.uid() AND p.role IN ('leader','secretary','foreman'))
    ))
  )
  WITH CHECK (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND (
      vihem_get_my_role() = 'admin'
      OR EXISTS (SELECT 1 FROM public.vihem_meeting_segment_participants p WHERE p.meeting_id = vihem_meeting_week_plan_items.meeting_id AND p.user_id = auth.uid() AND p.role IN ('leader','secretary','foreman'))
    ))
  );

-- Missing-documentation tracking (receipts, timesheets, etc.) -- a real,
-- reviewable row rather than only an ai_suggestions.payload field, per the
-- spec's requirement that it link to a responsible person/project/work
-- order/customer/supplier/invoice/deadline.
CREATE TABLE IF NOT EXISTS public.vihem_meeting_missing_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.vihem_meetings(id) ON DELETE CASCADE,
  description text NOT NULL,
  responsible_user_id uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  related_entity_type text NOT NULL DEFAULT '',
  related_entity_id uuid,
  deadline date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','submitted','resolved','cancelled')),
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vihem_meeting_missing_documents_meeting ON public.vihem_meeting_missing_documents(meeting_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.vihem_meeting_missing_documents;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.vihem_meeting_missing_documents
  FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at();

ALTER TABLE public.vihem_meeting_missing_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM segment participants read missing documents" ON public.vihem_meeting_missing_documents;
CREATE POLICY "VIHEM segment participants read missing documents" ON public.vihem_meeting_missing_documents
  FOR SELECT TO authenticated
  USING (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND (
      vihem_get_my_role() = 'admin'
      OR responsible_user_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.vihem_meeting_segment_participants p WHERE p.meeting_id = vihem_meeting_missing_documents.meeting_id AND p.user_id = auth.uid())
    ))
  );

DROP POLICY IF EXISTS "VIHEM meeting leaders manage missing documents" ON public.vihem_meeting_missing_documents;
CREATE POLICY "VIHEM meeting leaders manage missing documents" ON public.vihem_meeting_missing_documents
  FOR ALL TO authenticated
  USING (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND (
      vihem_get_my_role() = 'admin'
      OR EXISTS (SELECT 1 FROM public.vihem_meeting_segment_participants p WHERE p.meeting_id = vihem_meeting_missing_documents.meeting_id AND p.user_id = auth.uid() AND p.role IN ('leader','secretary'))
    ))
  )
  WITH CHECK (
    vihem_get_my_role() = 'superadmin'
    OR (organisation_id = vihem_get_my_org_id() AND (
      vihem_get_my_role() = 'admin'
      OR EXISTS (SELECT 1 FROM public.vihem_meeting_segment_participants p WHERE p.meeting_id = vihem_meeting_missing_documents.meeting_id AND p.user_id = auth.uid() AND p.role IN ('leader','secretary'))
    ))
  );

-- Extend vihem_ai_suggestions for the meeting review queue: link to the
-- run that produced it, and carry the target's version at analysis time
-- for atomic conflict detection on approve (see vihem-meeting-ai-apply).
ALTER TABLE public.vihem_ai_suggestions
  ADD COLUMN IF NOT EXISTS meeting_segment_run_id uuid REFERENCES public.vihem_meeting_ai_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.vihem_ai_suggestions DROP CONSTRAINT IF EXISTS vihem_ai_suggestions_status_check;
ALTER TABLE public.vihem_ai_suggestions ADD CONSTRAINT vihem_ai_suggestions_status_check
  CHECK (status IN ('pending','needs_input','approved','applying','applied','rejected','postponed','conflict','integration_unavailable','failed','cancelled'));

CREATE INDEX IF NOT EXISTS idx_vihem_ai_suggestions_run ON public.vihem_ai_suggestions(meeting_segment_run_id);

-- Now that vihem_meeting_ai_runs exists, wire the deferred FK from the
-- handoffs table (created in the prior migration before this table did).
ALTER TABLE public.vihem_meeting_handoffs DROP CONSTRAINT IF EXISTS vihem_meeting_handoffs_source_ai_suggestion_id_fkey;
ALTER TABLE public.vihem_meeting_handoffs
  ADD CONSTRAINT vihem_meeting_handoffs_source_ai_suggestion_id_fkey
  FOREIGN KEY (source_ai_suggestion_id) REFERENCES public.vihem_ai_suggestions(id) ON DELETE SET NULL;

ALTER TABLE public.vihem_screen_settings DROP CONSTRAINT IF EXISTS vihem_screen_settings_screen_view_check;
ALTER TABLE public.vihem_screen_settings ADD CONSTRAINT vihem_screen_settings_screen_view_check
  CHECK (screen_view IN ('short-stay','work-orders','presentation','laundry','meeting','meeting_segment'));

NOTIFY pgrst, 'reload schema';
