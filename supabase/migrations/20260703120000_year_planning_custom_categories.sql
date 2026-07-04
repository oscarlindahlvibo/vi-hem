/*
  # Year planning custom categories

  Lets each organisation manage the rings shown in the year wheel.
*/

CREATE TABLE IF NOT EXISTS public.vihem_planning_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  category_key text NOT NULL,
  label text NOT NULL,
  fill_color text NOT NULL DEFAULT '#f1f5f9',
  stroke_color text NOT NULL DEFAULT '#94a3b8',
  text_color text NOT NULL DEFAULT '#475569',
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  system_key boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, category_key)
);

ALTER TABLE public.vihem_planning_items
  DROP CONSTRAINT IF EXISTS vihem_planning_items_item_type_check;

ALTER TABLE public.vihem_planning_items
  ADD CONSTRAINT vihem_planning_items_item_type_check
  CHECK (item_type ~ '^[a-z0-9_:-]{1,64}$');

DROP TRIGGER IF EXISTS set_updated_at ON public.vihem_planning_categories;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.vihem_planning_categories
  FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at();

ALTER TABLE public.vihem_planning_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM org users can read" ON public.vihem_planning_categories;
CREATE POLICY "VIHEM org users can read"
  ON public.vihem_planning_categories FOR SELECT
  TO authenticated
  USING (public.vihem_get_my_role() = 'superadmin' OR organisation_id = public.vihem_get_my_org_id());

DROP POLICY IF EXISTS "VIHEM staff can insert org rows" ON public.vihem_planning_categories;
DROP POLICY IF EXISTS "VIHEM staff can update org rows" ON public.vihem_planning_categories;
DROP POLICY IF EXISTS "VIHEM admins can delete org rows" ON public.vihem_planning_categories;

DROP POLICY IF EXISTS "VIHEM planning admins can insert categories" ON public.vihem_planning_categories;
CREATE POLICY "VIHEM planning admins can insert categories"
  ON public.vihem_planning_categories FOR INSERT
  TO authenticated
  WITH CHECK (
    public.vihem_get_my_role() = 'superadmin'
    OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() = 'admin')
  );

DROP POLICY IF EXISTS "VIHEM planning admins can update categories" ON public.vihem_planning_categories;
CREATE POLICY "VIHEM planning admins can update categories"
  ON public.vihem_planning_categories FOR UPDATE
  TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() = 'admin')
  )
  WITH CHECK (
    public.vihem_get_my_role() = 'superadmin'
    OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() = 'admin')
  );

DROP POLICY IF EXISTS "VIHEM planning admins can delete categories" ON public.vihem_planning_categories;
CREATE POLICY "VIHEM planning admins can delete categories"
  ON public.vihem_planning_categories FOR DELETE
  TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() = 'admin')
  );

INSERT INTO public.vihem_planning_categories
  (organisation_id, category_key, label, fill_color, stroke_color, text_color, sort_order, system_key)
SELECT organisations.id, category_key, label, fill_color, stroke_color, text_color, sort_order, true
FROM public.vihem_organisations AS organisations
CROSS JOIN (
  VALUES
    ('maintenance', 'Underhåll', '#fef3c7', '#f59e0b', '#b45309', 10),
    ('inspection', 'Besiktning', '#dcfce7', '#4ade80', '#15803d', 20),
    ('work_order', 'Arbetsorder', '#dbeafe', '#60a5fa', '#1d4ed8', 30),
    ('meeting', 'Möten', '#ede9fe', '#8b5cf6', '#6d28d9', 40),
    ('project', 'Projekt', '#ccfbf1', '#14b8a6', '#0f766e', 50),
    ('inventory', 'Inventarier', '#e0f2fe', '#38bdf8', '#0369a1', 60),
    ('absence', 'Frånvaro', '#fee2e2', '#f87171', '#b91c1c', 70),
    ('custom', 'Övrigt', '#f1f5f9', '#94a3b8', '#475569', 80)
) AS defaults(category_key, label, fill_color, stroke_color, text_color, sort_order)
ON CONFLICT (organisation_id, category_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
