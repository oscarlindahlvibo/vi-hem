-- Drift & rutiner -- Städvagn/inventarielistor. Reuses the existing
-- vihem_inventory_stock_items/vihem_inventory_balances/vihem_purchase_items
-- tables for the actual stock numbers and shortages -- no parallel
-- inventory system, per the spec's explicit instruction. A template item
-- can optionally point at a real stock item (stock_item_id); when it does,
-- "Hämta från lager" reads its current vihem_inventory_balances quantity,
-- and "Lägg till inköpslista" inserts into vihem_purchase_items the same
-- way InventoryPage.tsx's own low-stock action already does.

CREATE TABLE IF NOT EXISTS public.vihem_inventory_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  name text NOT NULL,
  qr_token uuid NOT NULL DEFAULT gen_random_uuid(),
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vihem_inventory_templates_qr_token_key UNIQUE (qr_token)
);

CREATE TABLE IF NOT EXISTS public.vihem_inventory_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.vihem_inventory_templates(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  label text NOT NULL,
  desired_quantity numeric(14,3) NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'st',
  stock_item_id uuid REFERENCES public.vihem_inventory_stock_items(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_vihem_inventory_template_items_template ON public.vihem_inventory_template_items (template_id);

CREATE TABLE IF NOT EXISTS public.vihem_inventory_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.vihem_inventory_templates(id) ON DELETE CASCADE,
  location_note text NOT NULL DEFAULT '',
  performed_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  performed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vihem_inventory_check_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id uuid NOT NULL REFERENCES public.vihem_inventory_checks(id) ON DELETE CASCADE,
  template_item_id uuid REFERENCES public.vihem_inventory_template_items(id) ON DELETE SET NULL,
  -- snapshotted at check time so a later template edit never rewrites history
  label text NOT NULL,
  desired_quantity numeric(14,3) NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'st',
  actual_quantity numeric(14,3),
  shortage numeric(14,3) GENERATED ALWAYS AS (GREATEST(desired_quantity - COALESCE(actual_quantity, desired_quantity), 0)) STORED,
  action text NOT NULL DEFAULT 'none' CHECK (action IN ('none', 'requested_from_stock', 'added_to_purchase_list'))
);

CREATE INDEX IF NOT EXISTS idx_vihem_inventory_check_items_check ON public.vihem_inventory_check_items (check_id);

ALTER TABLE public.vihem_inventory_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_inventory_template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_inventory_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_inventory_check_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vihem_inventory_templates_select ON public.vihem_inventory_templates;
CREATE POLICY vihem_inventory_templates_select ON public.vihem_inventory_templates
  FOR SELECT
  USING (organisation_id IN (SELECT organisation_id FROM public.vihem_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS vihem_inventory_templates_manage ON public.vihem_inventory_templates;
CREATE POLICY vihem_inventory_templates_manage ON public.vihem_inventory_templates
  FOR ALL
  USING (organisation_id IN (SELECT organisation_id FROM public.vihem_profiles WHERE id = auth.uid() AND role IN ('admin', 'superadmin')))
  WITH CHECK (organisation_id IN (SELECT organisation_id FROM public.vihem_profiles WHERE id = auth.uid() AND role IN ('admin', 'superadmin')));

DROP POLICY IF EXISTS vihem_inventory_template_items_select ON public.vihem_inventory_template_items;
CREATE POLICY vihem_inventory_template_items_select ON public.vihem_inventory_template_items
  FOR SELECT
  USING (template_id IN (SELECT id FROM public.vihem_inventory_templates));

DROP POLICY IF EXISTS vihem_inventory_template_items_manage ON public.vihem_inventory_template_items;
CREATE POLICY vihem_inventory_template_items_manage ON public.vihem_inventory_template_items
  FOR ALL
  USING (template_id IN (SELECT t.id FROM public.vihem_inventory_templates t JOIN public.vihem_profiles p ON p.organisation_id = t.organisation_id WHERE p.id = auth.uid() AND p.role IN ('admin', 'superadmin')))
  WITH CHECK (template_id IN (SELECT t.id FROM public.vihem_inventory_templates t JOIN public.vihem_profiles p ON p.organisation_id = t.organisation_id WHERE p.id = auth.uid() AND p.role IN ('admin', 'superadmin')));

DROP POLICY IF EXISTS vihem_inventory_checks_select ON public.vihem_inventory_checks;
CREATE POLICY vihem_inventory_checks_select ON public.vihem_inventory_checks
  FOR SELECT
  USING (organisation_id IN (SELECT organisation_id FROM public.vihem_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS vihem_inventory_checks_manage ON public.vihem_inventory_checks;
CREATE POLICY vihem_inventory_checks_manage ON public.vihem_inventory_checks
  FOR ALL
  USING (organisation_id IN (SELECT organisation_id FROM public.vihem_profiles WHERE id = auth.uid() AND role IN ('staff', 'admin', 'superadmin')))
  WITH CHECK (organisation_id IN (SELECT organisation_id FROM public.vihem_profiles WHERE id = auth.uid() AND role IN ('staff', 'admin', 'superadmin')));

DROP POLICY IF EXISTS vihem_inventory_check_items_select ON public.vihem_inventory_check_items;
CREATE POLICY vihem_inventory_check_items_select ON public.vihem_inventory_check_items
  FOR SELECT
  USING (check_id IN (SELECT id FROM public.vihem_inventory_checks));

DROP POLICY IF EXISTS vihem_inventory_check_items_manage ON public.vihem_inventory_check_items;
CREATE POLICY vihem_inventory_check_items_manage ON public.vihem_inventory_check_items
  FOR ALL
  USING (check_id IN (SELECT c.id FROM public.vihem_inventory_checks c JOIN public.vihem_profiles p ON p.organisation_id = c.organisation_id WHERE p.id = auth.uid() AND p.role IN ('staff', 'admin', 'superadmin')))
  WITH CHECK (check_id IN (SELECT c.id FROM public.vihem_inventory_checks c JOIN public.vihem_profiles p ON p.organisation_id = c.organisation_id WHERE p.id = auth.uid() AND p.role IN ('staff', 'admin', 'superadmin')));

NOTIFY pgrst, 'reload schema';
