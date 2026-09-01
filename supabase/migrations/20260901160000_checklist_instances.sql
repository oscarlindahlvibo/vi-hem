-- Drift & rutiner -- Checklistor. When a routine's checklist template is
-- attached to a work order, its steps are COPIED into a new instance (not
-- referenced live), so ticking a box here never mutates the reusable
-- routine template -- exactly the "kopieras som en instans" requirement.

CREATE TABLE IF NOT EXISTS public.vihem_checklist_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  source_routine_version_id uuid REFERENCES public.vihem_routine_versions(id) ON DELETE SET NULL,
  work_order_id uuid REFERENCES public.vihem_work_orders(id) ON DELETE CASCADE,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_vihem_checklist_instances_wo ON public.vihem_checklist_instances (work_order_id);
CREATE INDEX IF NOT EXISTS idx_vihem_checklist_instances_org ON public.vihem_checklist_instances (organisation_id);

CREATE TABLE IF NOT EXISTS public.vihem_checklist_instance_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL REFERENCES public.vihem_checklist_instances(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  label text NOT NULL,
  required boolean NOT NULL DEFAULT false,
  requires_photo boolean NOT NULL DEFAULT false,
  completed_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  completed_at timestamptz,
  comment text NOT NULL DEFAULT '',
  photo_storage_path text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_vihem_checklist_instance_items_instance ON public.vihem_checklist_instance_items (instance_id);

ALTER TABLE public.vihem_checklist_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_checklist_instance_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vihem_checklist_instances_select ON public.vihem_checklist_instances;
CREATE POLICY vihem_checklist_instances_select ON public.vihem_checklist_instances
  FOR SELECT
  USING (organisation_id IN (SELECT organisation_id FROM public.vihem_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS vihem_checklist_instances_manage ON public.vihem_checklist_instances;
CREATE POLICY vihem_checklist_instances_manage ON public.vihem_checklist_instances
  FOR ALL
  USING (
    organisation_id IN (
      SELECT organisation_id FROM public.vihem_profiles WHERE id = auth.uid() AND role IN ('staff', 'admin', 'superadmin')
    )
  )
  WITH CHECK (
    organisation_id IN (
      SELECT organisation_id FROM public.vihem_profiles WHERE id = auth.uid() AND role IN ('staff', 'admin', 'superadmin')
    )
  );

DROP POLICY IF EXISTS vihem_checklist_instance_items_select ON public.vihem_checklist_instance_items;
CREATE POLICY vihem_checklist_instance_items_select ON public.vihem_checklist_instance_items
  FOR SELECT
  USING (instance_id IN (SELECT id FROM public.vihem_checklist_instances));

DROP POLICY IF EXISTS vihem_checklist_instance_items_manage ON public.vihem_checklist_instance_items;
CREATE POLICY vihem_checklist_instance_items_manage ON public.vihem_checklist_instance_items
  FOR ALL
  USING (
    instance_id IN (
      SELECT ci.id FROM public.vihem_checklist_instances ci
      JOIN public.vihem_profiles p ON p.organisation_id = ci.organisation_id
      WHERE p.id = auth.uid() AND p.role IN ('staff', 'admin', 'superadmin')
    )
  )
  WITH CHECK (
    instance_id IN (
      SELECT ci.id FROM public.vihem_checklist_instances ci
      JOIN public.vihem_profiles p ON p.organisation_id = ci.organisation_id
      WHERE p.id = auth.uid() AND p.role IN ('staff', 'admin', 'superadmin')
    )
  );

NOTIFY pgrst, 'reload schema';
