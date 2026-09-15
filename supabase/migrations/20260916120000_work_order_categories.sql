-- Admin-configurable work order categories, same pattern as
-- vihem_time_categories (20260902120000_time_categories.sql): the
-- category picker on vihem_work_orders was a fixed, hardcoded list
-- (WO_CATEGORIES in src/lib/utils.ts) with no way for an admin to add or
-- retire one. vihem_work_orders.category was always a freeform text
-- column with no CHECK constraint, so this is purely additive -- existing
-- rows keep working untouched.

CREATE TABLE IF NOT EXISTS public.vihem_work_order_categories (
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

CREATE INDEX IF NOT EXISTS idx_vihem_work_order_categories_org ON public.vihem_work_order_categories(organisation_id);

ALTER TABLE public.vihem_work_order_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM org members can read work order categories" ON public.vihem_work_order_categories;
CREATE POLICY "VIHEM org members can read work order categories" ON public.vihem_work_order_categories
  FOR SELECT TO authenticated
  USING (organisation_id = get_my_org_id());

DROP POLICY IF EXISTS "VIHEM admin can insert work order categories" ON public.vihem_work_order_categories;
CREATE POLICY "VIHEM admin can insert work order categories" ON public.vihem_work_order_categories
  FOR INSERT TO authenticated
  WITH CHECK (organisation_id = get_my_org_id() AND get_my_role() IN ('admin', 'superadmin'));

DROP POLICY IF EXISTS "VIHEM admin can update work order categories" ON public.vihem_work_order_categories;
CREATE POLICY "VIHEM admin can update work order categories" ON public.vihem_work_order_categories
  FOR UPDATE TO authenticated
  USING (organisation_id = get_my_org_id() AND get_my_role() IN ('admin', 'superadmin'))
  WITH CHECK (organisation_id = get_my_org_id() AND get_my_role() IN ('admin', 'superadmin'));

-- Seed the existing 18 static categories (WO_CATEGORIES in src/lib/utils.ts)
-- as protected built-ins for every existing organisation, so every
-- existing work order's category keeps showing up in the picker unchanged.
INSERT INTO public.vihem_work_order_categories (organisation_id, key, label, sort_order, is_builtin)
SELECT o.id, v.key, v.label, v.sort_order, true
FROM public.vihem_organisations o
CROSS JOIN (VALUES
  ('fastighetsunderhall', 'Fastighetsunderhåll', 1),
  ('felanmalan', 'Felanmälan', 2),
  ('el', 'El', 3),
  ('vvs', 'VVS', 4),
  ('varme', 'Värme', 5),
  ('ventilation', 'Ventilation', 6),
  ('snickeri', 'Snickeri', 7),
  ('malning', 'Målning', 8),
  ('stad', 'Städ', 9),
  ('utemiljo', 'Utemiljö', 10),
  ('snorojning', 'Snöröjning', 11),
  ('kundprojekt', 'Kundprojekt', 12),
  ('administration', 'Administration', 13),
  ('besiktning', 'Besiktning', 14),
  ('akut_atgard', 'Akut åtgärd', 15),
  ('forebyggande_underhall', 'Förebyggande underhåll', 16),
  ('vitvaror', 'Vitvaror', 17),
  ('ovrigt', 'Övrigt', 18)
) AS v(key, label, sort_order)
ON CONFLICT (organisation_id, key) DO NOTHING;

-- New organisations created after this migration also get the seed.
CREATE OR REPLACE FUNCTION public.seed_default_work_order_categories()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.vihem_work_order_categories (organisation_id, key, label, sort_order, is_builtin)
  VALUES
    (NEW.id, 'fastighetsunderhall', 'Fastighetsunderhåll', 1, true),
    (NEW.id, 'felanmalan', 'Felanmälan', 2, true),
    (NEW.id, 'el', 'El', 3, true),
    (NEW.id, 'vvs', 'VVS', 4, true),
    (NEW.id, 'varme', 'Värme', 5, true),
    (NEW.id, 'ventilation', 'Ventilation', 6, true),
    (NEW.id, 'snickeri', 'Snickeri', 7, true),
    (NEW.id, 'malning', 'Målning', 8, true),
    (NEW.id, 'stad', 'Städ', 9, true),
    (NEW.id, 'utemiljo', 'Utemiljö', 10, true),
    (NEW.id, 'snorojning', 'Snöröjning', 11, true),
    (NEW.id, 'kundprojekt', 'Kundprojekt', 12, true),
    (NEW.id, 'administration', 'Administration', 13, true),
    (NEW.id, 'besiktning', 'Besiktning', 14, true),
    (NEW.id, 'akut_atgard', 'Akut åtgärd', 15, true),
    (NEW.id, 'forebyggande_underhall', 'Förebyggande underhåll', 16, true),
    (NEW.id, 'vitvaror', 'Vitvaror', 17, true),
    (NEW.id, 'ovrigt', 'Övrigt', 18, true)
  ON CONFLICT (organisation_id, key) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_default_work_order_categories ON public.vihem_organisations;
CREATE TRIGGER trg_seed_default_work_order_categories
  AFTER INSERT ON public.vihem_organisations
  FOR EACH ROW EXECUTE FUNCTION public.seed_default_work_order_categories();

NOTIFY pgrst, 'reload schema';
