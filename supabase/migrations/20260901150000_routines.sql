-- Drift & rutiner -- Rutiner & instruktioner. A routine's editable content
-- lives in versions (vihem_routine_versions), never edited in place once a
-- version exists -- publishing/editing always creates a new version row,
-- so "publicerade rutiner ska inte kunna förändras helt spårlöst" holds
-- structurally, not just by convention. vihem_routines.current_version_id
-- is added via ALTER after vihem_routine_versions exists (the two tables
-- reference each other).

CREATE TABLE IF NOT EXISTS public.vihem_routines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'ovrigt',
  summary text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  is_emergency boolean NOT NULL DEFAULT false,
  applies_to_roles text[] NOT NULL DEFAULT ARRAY['staff', 'admin']::text[],
  requires_acknowledgement boolean NOT NULL DEFAULT false,
  valid_from date,
  valid_to date,
  current_version_id uuid,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vihem_routine_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_id uuid NOT NULL REFERENCES public.vihem_routines(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  body text NOT NULL DEFAULT '',
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings text NOT NULL DEFAULT '',
  tips text NOT NULL DEFAULT '',
  responsible_user_id uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  changed_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  change_comment text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vihem_routine_versions_unique_number UNIQUE (routine_id, version_number)
);

ALTER TABLE public.vihem_routines DROP CONSTRAINT IF EXISTS vihem_routines_current_version_fk;
ALTER TABLE public.vihem_routines
  ADD CONSTRAINT vihem_routines_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES public.vihem_routine_versions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.vihem_routine_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_version_id uuid NOT NULL REFERENCES public.vihem_routine_versions(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'file' CHECK (kind IN ('image', 'file', 'video_link')),
  storage_path text NOT NULL DEFAULT '',
  external_url text NOT NULL DEFAULT '',
  file_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Which properties/companies a routine applies to. An empty scope (no
-- rows) means "applies everywhere" -- most routines (e.g. "Airbnb-städ")
-- don't need per-property rows at all.
CREATE TABLE IF NOT EXISTS public.vihem_routine_scope (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_id uuid NOT NULL REFERENCES public.vihem_routines(id) ON DELETE CASCADE,
  property_id uuid REFERENCES public.vihem_properties(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.vihem_companies(id) ON DELETE CASCADE,
  CONSTRAINT vihem_routine_scope_target_check CHECK (property_id IS NOT NULL OR company_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_vihem_routine_scope_routine ON public.vihem_routine_scope (routine_id);
CREATE INDEX IF NOT EXISTS idx_vihem_routine_scope_property ON public.vihem_routine_scope (property_id);

-- The "lokalt tillägg" the spec asks for: a generic routine ("Airbnb-städ")
-- plus a short property-specific addendum, instead of duplicating the
-- whole routine per property.
CREATE TABLE IF NOT EXISTS public.vihem_routine_local_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_id uuid NOT NULL REFERENCES public.vihem_routines(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.vihem_properties(id) ON DELETE CASCADE,
  note text NOT NULL DEFAULT '',
  updated_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vihem_routine_local_notes_unique UNIQUE (routine_id, property_id)
);

CREATE TABLE IF NOT EXISTS public.vihem_routine_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_id uuid NOT NULL REFERENCES public.vihem_routines(id) ON DELETE CASCADE,
  routine_version_id uuid NOT NULL REFERENCES public.vihem_routine_versions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.vihem_profiles(id) ON DELETE CASCADE,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vihem_routine_acknowledgements_unique UNIQUE (routine_version_id, user_id)
);

-- Template steps a checklist_instance is copied from when a routine is
-- attached to a work order (see 20260901160000_checklist_instances.sql).
CREATE TABLE IF NOT EXISTS public.vihem_routine_checklist_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_version_id uuid NOT NULL REFERENCES public.vihem_routine_versions(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  label text NOT NULL,
  required boolean NOT NULL DEFAULT false,
  requires_photo boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_vihem_routine_checklist_templates_version ON public.vihem_routine_checklist_templates (routine_version_id);

-- ---- RLS ----

ALTER TABLE public.vihem_routines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_routine_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_routine_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_routine_scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_routine_local_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_routine_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_routine_checklist_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vihem_routines_select ON public.vihem_routines;
CREATE POLICY vihem_routines_select ON public.vihem_routines
  FOR SELECT
  USING (
    organisation_id IN (SELECT organisation_id FROM public.vihem_profiles WHERE id = auth.uid())
    AND public.vihem_has_permission(auth.uid(), 'routine.read')
  );

DROP POLICY IF EXISTS vihem_routines_manage ON public.vihem_routines;
CREATE POLICY vihem_routines_manage ON public.vihem_routines
  FOR ALL
  USING (
    organisation_id IN (SELECT organisation_id FROM public.vihem_profiles WHERE id = auth.uid())
    AND public.vihem_has_permission(auth.uid(), 'routine.edit')
  )
  WITH CHECK (
    organisation_id IN (SELECT organisation_id FROM public.vihem_profiles WHERE id = auth.uid())
    AND public.vihem_has_permission(auth.uid(), 'routine.edit')
  );

-- Versions/attachments/scope/local notes/checklist templates all inherit
-- the parent routine's organisation via a join rather than duplicating
-- organisation_id on every child table.
DROP POLICY IF EXISTS vihem_routine_versions_select ON public.vihem_routine_versions;
CREATE POLICY vihem_routine_versions_select ON public.vihem_routine_versions
  FOR SELECT
  USING (routine_id IN (SELECT id FROM public.vihem_routines));

DROP POLICY IF EXISTS vihem_routine_versions_manage ON public.vihem_routine_versions;
CREATE POLICY vihem_routine_versions_manage ON public.vihem_routine_versions
  FOR ALL
  USING (routine_id IN (SELECT id FROM public.vihem_routines WHERE public.vihem_has_permission(auth.uid(), 'routine.edit')))
  WITH CHECK (routine_id IN (SELECT id FROM public.vihem_routines WHERE public.vihem_has_permission(auth.uid(), 'routine.edit')));

DROP POLICY IF EXISTS vihem_routine_attachments_select ON public.vihem_routine_attachments;
CREATE POLICY vihem_routine_attachments_select ON public.vihem_routine_attachments
  FOR SELECT
  USING (routine_version_id IN (SELECT id FROM public.vihem_routine_versions));

DROP POLICY IF EXISTS vihem_routine_attachments_manage ON public.vihem_routine_attachments;
CREATE POLICY vihem_routine_attachments_manage ON public.vihem_routine_attachments
  FOR ALL
  USING (routine_version_id IN (SELECT v.id FROM public.vihem_routine_versions v JOIN public.vihem_routines r ON r.id = v.routine_id WHERE public.vihem_has_permission(auth.uid(), 'routine.edit')))
  WITH CHECK (routine_version_id IN (SELECT v.id FROM public.vihem_routine_versions v JOIN public.vihem_routines r ON r.id = v.routine_id WHERE public.vihem_has_permission(auth.uid(), 'routine.edit')));

DROP POLICY IF EXISTS vihem_routine_scope_select ON public.vihem_routine_scope;
CREATE POLICY vihem_routine_scope_select ON public.vihem_routine_scope
  FOR SELECT
  USING (routine_id IN (SELECT id FROM public.vihem_routines));

DROP POLICY IF EXISTS vihem_routine_scope_manage ON public.vihem_routine_scope;
CREATE POLICY vihem_routine_scope_manage ON public.vihem_routine_scope
  FOR ALL
  USING (routine_id IN (SELECT id FROM public.vihem_routines WHERE public.vihem_has_permission(auth.uid(), 'routine.edit')))
  WITH CHECK (routine_id IN (SELECT id FROM public.vihem_routines WHERE public.vihem_has_permission(auth.uid(), 'routine.edit')));

DROP POLICY IF EXISTS vihem_routine_local_notes_select ON public.vihem_routine_local_notes;
CREATE POLICY vihem_routine_local_notes_select ON public.vihem_routine_local_notes
  FOR SELECT
  USING (routine_id IN (SELECT id FROM public.vihem_routines));

DROP POLICY IF EXISTS vihem_routine_local_notes_manage ON public.vihem_routine_local_notes;
CREATE POLICY vihem_routine_local_notes_manage ON public.vihem_routine_local_notes
  FOR ALL
  USING (routine_id IN (SELECT id FROM public.vihem_routines WHERE public.vihem_has_permission(auth.uid(), 'routine.edit')))
  WITH CHECK (routine_id IN (SELECT id FROM public.vihem_routines WHERE public.vihem_has_permission(auth.uid(), 'routine.edit')));

DROP POLICY IF EXISTS vihem_routine_checklist_templates_select ON public.vihem_routine_checklist_templates;
CREATE POLICY vihem_routine_checklist_templates_select ON public.vihem_routine_checklist_templates
  FOR SELECT
  USING (routine_version_id IN (SELECT id FROM public.vihem_routine_versions));

DROP POLICY IF EXISTS vihem_routine_checklist_templates_manage ON public.vihem_routine_checklist_templates;
CREATE POLICY vihem_routine_checklist_templates_manage ON public.vihem_routine_checklist_templates
  FOR ALL
  USING (routine_version_id IN (SELECT v.id FROM public.vihem_routine_versions v JOIN public.vihem_routines r ON r.id = v.routine_id WHERE public.vihem_has_permission(auth.uid(), 'routine.edit')))
  WITH CHECK (routine_version_id IN (SELECT v.id FROM public.vihem_routine_versions v JOIN public.vihem_routines r ON r.id = v.routine_id WHERE public.vihem_has_permission(auth.uid(), 'routine.edit')));

-- Acknowledgements: a user can only insert/read their own row; admins/
-- managers can read all of their org's for the completion-count view.
DROP POLICY IF EXISTS vihem_routine_acknowledgements_select ON public.vihem_routine_acknowledgements;
CREATE POLICY vihem_routine_acknowledgements_select ON public.vihem_routine_acknowledgements
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR routine_id IN (SELECT id FROM public.vihem_routines WHERE public.vihem_has_permission(auth.uid(), 'routine.edit'))
  );

DROP POLICY IF EXISTS vihem_routine_acknowledgements_insert ON public.vihem_routine_acknowledgements;
CREATE POLICY vihem_routine_acknowledgements_insert ON public.vihem_routine_acknowledgements
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND routine_id IN (SELECT id FROM public.vihem_routines WHERE public.vihem_has_permission(auth.uid(), 'routine.read'))
  );

NOTIFY pgrst, 'reload schema';
