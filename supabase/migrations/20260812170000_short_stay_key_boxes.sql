CREATE TABLE IF NOT EXISTS public.vihem_short_stay_key_boxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.vihem_short_stay_units(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Nyckelbox',
  code text NOT NULL,
  location text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vihem_short_stay_key_boxes_name_check CHECK (length(trim(name)) > 0),
  CONSTRAINT vihem_short_stay_key_boxes_code_check CHECK (length(trim(code)) > 0),
  CONSTRAINT vihem_short_stay_key_boxes_unit_unique UNIQUE (organisation_id, unit_id, name)
);

CREATE INDEX IF NOT EXISTS vihem_short_stay_key_boxes_org_idx
  ON public.vihem_short_stay_key_boxes (organisation_id, active);
CREATE INDEX IF NOT EXISTS vihem_short_stay_key_boxes_unit_idx
  ON public.vihem_short_stay_key_boxes (unit_id);

CREATE UNIQUE INDEX IF NOT EXISTS vihem_short_stay_units_org_id_unique
  ON public.vihem_short_stay_units (organisation_id, id);

ALTER TABLE public.vihem_short_stay_key_boxes
  DROP CONSTRAINT IF EXISTS vihem_short_stay_key_boxes_unit_org_fkey;
ALTER TABLE public.vihem_short_stay_key_boxes
  ADD CONSTRAINT vihem_short_stay_key_boxes_unit_org_fkey
  FOREIGN KEY (organisation_id, unit_id)
  REFERENCES public.vihem_short_stay_units (organisation_id, id)
  ON DELETE CASCADE;

ALTER TABLE public.vihem_short_stay_key_boxes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM short stay key boxes read" ON public.vihem_short_stay_key_boxes;
CREATE POLICY "VIHEM short stay key boxes read"
  ON public.vihem_short_stay_key_boxes
  FOR SELECT TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_get_my_role() IN ('staff', 'admin')
    )
  );

DROP POLICY IF EXISTS "VIHEM short stay key boxes admin insert" ON public.vihem_short_stay_key_boxes;
CREATE POLICY "VIHEM short stay key boxes admin insert"
  ON public.vihem_short_stay_key_boxes
  FOR INSERT TO authenticated
  WITH CHECK (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_get_my_role() = 'admin'
    )
  );

DROP POLICY IF EXISTS "VIHEM short stay key boxes admin update" ON public.vihem_short_stay_key_boxes;
CREATE POLICY "VIHEM short stay key boxes admin update"
  ON public.vihem_short_stay_key_boxes
  FOR UPDATE TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_get_my_role() = 'admin'
    )
  )
  WITH CHECK (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_get_my_role() = 'admin'
    )
  );

DROP POLICY IF EXISTS "VIHEM short stay key boxes admin delete" ON public.vihem_short_stay_key_boxes;
CREATE POLICY "VIHEM short stay key boxes admin delete"
  ON public.vihem_short_stay_key_boxes
  FOR DELETE TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_get_my_role() = 'admin'
    )
  );

NOTIFY pgrst, 'reload schema';
