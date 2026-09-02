-- Admin-configurable time-entry categories.
--
-- vihem_time_entries.category was locked to a fixed 9-value CHECK
-- constraint (general/work_order/maintenance/customer_project/admin/
-- travel/shopping/standby/other). A TestFlight tester asked for a
-- "Städning" (cleaning) category with no way to add one short of a
-- migration. This turns the category list into a per-organisation table
-- admins manage from the UI, seeded with the original 9 as protected
-- (is_builtin) rows so every existing entry/report keeps working.

CREATE TABLE IF NOT EXISTS public.vihem_time_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  is_builtin boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.vihem_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, key)
);

CREATE INDEX IF NOT EXISTS idx_vihem_time_categories_org ON public.vihem_time_categories(organisation_id);

ALTER TABLE public.vihem_time_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM org members can read time categories" ON public.vihem_time_categories;
CREATE POLICY "VIHEM org members can read time categories" ON public.vihem_time_categories
  FOR SELECT TO authenticated
  USING (organisation_id = get_my_org_id());

DROP POLICY IF EXISTS "VIHEM admin can insert time categories" ON public.vihem_time_categories;
CREATE POLICY "VIHEM admin can insert time categories" ON public.vihem_time_categories
  FOR INSERT TO authenticated
  WITH CHECK (organisation_id = get_my_org_id() AND get_my_role() IN ('admin', 'superadmin'));

DROP POLICY IF EXISTS "VIHEM admin can update time categories" ON public.vihem_time_categories;
CREATE POLICY "VIHEM admin can update time categories" ON public.vihem_time_categories
  FOR UPDATE TO authenticated
  USING (organisation_id = get_my_org_id() AND get_my_role() IN ('admin', 'superadmin'))
  WITH CHECK (organisation_id = get_my_org_id() AND get_my_role() IN ('admin', 'superadmin'));

-- Seed the original 9 built-ins for every existing organisation.
INSERT INTO public.vihem_time_categories (organisation_id, key, label, sort_order, is_builtin)
SELECT o.id, v.key, v.label, v.sort_order, true
FROM public.vihem_organisations o
CROSS JOIN (VALUES
  ('general', 'Allmänt fastighetsunderhåll', 1),
  ('work_order', 'Arbetsorder', 2),
  ('maintenance', 'Felanmälan', 3),
  ('customer_project', 'Kundprojekt', 4),
  ('admin', 'Administration', 5),
  ('travel', 'Resa/Transport', 6),
  ('shopping', 'Inköp/Material', 7),
  ('standby', 'Jour', 8),
  ('other', 'Annat', 9)
) AS v(key, label, sort_order)
ON CONFLICT (organisation_id, key) DO NOTHING;

-- New organisations created after this migration also need the seed --
-- keep it in sync automatically instead of relying on a future migration
-- remembering to re-seed.
CREATE OR REPLACE FUNCTION public.seed_default_time_categories()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.vihem_time_categories (organisation_id, key, label, sort_order, is_builtin)
  VALUES
    (NEW.id, 'general', 'Allmänt fastighetsunderhåll', 1, true),
    (NEW.id, 'work_order', 'Arbetsorder', 2, true),
    (NEW.id, 'maintenance', 'Felanmälan', 3, true),
    (NEW.id, 'customer_project', 'Kundprojekt', 4, true),
    (NEW.id, 'admin', 'Administration', 5, true),
    (NEW.id, 'travel', 'Resa/Transport', 6, true),
    (NEW.id, 'shopping', 'Inköp/Material', 7, true),
    (NEW.id, 'standby', 'Jour', 8, true),
    (NEW.id, 'other', 'Annat', 9, true)
  ON CONFLICT (organisation_id, key) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_default_time_categories ON public.vihem_organisations;
CREATE TRIGGER trg_seed_default_time_categories
  AFTER INSERT ON public.vihem_organisations
  FOR EACH ROW EXECUTE FUNCTION public.seed_default_time_categories();

-- The old fixed CHECK constraint can't accommodate admin-added categories.
ALTER TABLE public.vihem_time_entries DROP CONSTRAINT IF EXISTS time_entries_category_check;
ALTER TABLE public.vihem_time_entries ADD CONSTRAINT time_entries_category_check CHECK (category <> '');

NOTIFY pgrst, 'reload schema';
