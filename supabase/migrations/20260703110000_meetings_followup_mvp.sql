/*
  # VI-HEM Meetings & Follow-up MVP

  Extends the platform meeting tables with participants, protocol rows,
  object links and meeting module enablement.
*/

ALTER TABLE public.vihem_meetings
  ADD COLUMN IF NOT EXISTS participant_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS protocol text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS previous_meeting_id uuid REFERENCES public.vihem_meetings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.vihem_meeting_agenda_items
  ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_id uuid,
  ADD COLUMN IF NOT EXISTS linked_entity_type text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS linked_entity_id uuid,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.vihem_meeting_decisions
  ADD COLUMN IF NOT EXISTS linked_entity_type text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS linked_entity_id uuid,
  ADD COLUMN IF NOT EXISTS comments text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS history jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS public.vihem_meeting_protocol_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.vihem_meetings(id) ON DELETE CASCADE,
  agenda_item_id uuid REFERENCES public.vihem_meeting_agenda_items(id) ON DELETE SET NULL,
  row_type text NOT NULL DEFAULT 'information'
    CHECK (row_type IN ('information', 'decision', 'task', 'change', 'risk', 'parked', 'follow_up', 'deviation', 'customer_message', 'internal_note')),
  content text NOT NULL,
  linked_entity_type text NOT NULL DEFAULT '',
  linked_entity_id uuid,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vihem_meeting_object_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.vihem_meetings(id) ON DELETE CASCADE,
  agenda_item_id uuid REFERENCES public.vihem_meeting_agenda_items(id) ON DELETE CASCADE,
  protocol_row_id uuid REFERENCES public.vihem_meeting_protocol_rows(id) ON DELETE CASCADE,
  decision_id uuid REFERENCES public.vihem_meeting_decisions(id) ON DELETE CASCADE,
  action_item_id uuid REFERENCES public.vihem_meeting_action_items(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  label text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vihem_meetings_org_status_idx ON public.vihem_meetings(organisation_id, status, starts_at);
CREATE INDEX IF NOT EXISTS vihem_meetings_participants_idx ON public.vihem_meetings USING gin(participant_ids);
CREATE INDEX IF NOT EXISTS vihem_meeting_protocol_rows_meeting_idx ON public.vihem_meeting_protocol_rows(meeting_id, created_at);
CREATE INDEX IF NOT EXISTS vihem_meeting_object_links_meeting_idx ON public.vihem_meeting_object_links(meeting_id, entity_type);

DROP TRIGGER IF EXISTS set_updated_at ON public.vihem_meeting_protocol_rows;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.vihem_meeting_protocol_rows
  FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at();

ALTER TABLE public.vihem_meeting_protocol_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_meeting_object_links ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'vihem_meeting_protocol_rows',
    'vihem_meeting_object_links'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "VIHEM org users can read" ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY "VIHEM org users can read" ON public.%I FOR SELECT TO authenticated USING (public.vihem_get_my_role() = ''superadmin'' OR organisation_id = public.vihem_get_my_org_id())',
      table_name
    );

    EXECUTE format('DROP POLICY IF EXISTS "VIHEM staff can insert org rows" ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY "VIHEM staff can insert org rows" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.vihem_get_my_role() = ''superadmin'' OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN (''staff'', ''admin'')))',
      table_name
    );

    EXECUTE format('DROP POLICY IF EXISTS "VIHEM staff can update org rows" ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY "VIHEM staff can update org rows" ON public.%I FOR UPDATE TO authenticated USING (public.vihem_get_my_role() = ''superadmin'' OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN (''staff'', ''admin''))) WITH CHECK (public.vihem_get_my_role() = ''superadmin'' OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN (''staff'', ''admin'')))',
      table_name
    );

    EXECUTE format('DROP POLICY IF EXISTS "VIHEM admins can delete org rows" ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY "VIHEM admins can delete org rows" ON public.%I FOR DELETE TO authenticated USING (public.vihem_get_my_role() = ''superadmin'' OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() = ''admin''))',
      table_name
    );
  END LOOP;
END;
$$;

INSERT INTO public.vihem_module_registry
  (module_key, name, description, category, default_enabled, default_limits, default_settings, sort_order)
VALUES
  ('meetings', 'Möten & Uppföljning', 'Strukturerade möten, dagordning, protokoll, beslut och uppgifter.', 'planning', false, '{}'::jsonb, '{"ai_requires_approval": true}'::jsonb, 145)
ON CONFLICT (module_key) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  default_settings = EXCLUDED.default_settings,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

INSERT INTO public.vihem_organisation_modules (organisation_id, module_key, enabled, limits, settings)
SELECT id, 'meetings', false, '{}'::jsonb, '{"ai_requires_approval": true}'::jsonb
FROM public.vihem_organisations
ON CONFLICT (organisation_id, module_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
