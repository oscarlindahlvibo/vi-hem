CREATE TABLE IF NOT EXISTS public.vihem_short_stay_common_cleanings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  due_date date NOT NULL DEFAULT CURRENT_DATE,
  required_unit_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  cleaning_status text NOT NULL DEFAULT 'dirty' CHECK (cleaning_status IN ('not_needed', 'dirty', 'in_progress', 'clean')),
  completed_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vihem_short_stay_common_cleanings_org_due
  ON public.vihem_short_stay_common_cleanings(organisation_id, due_date);

ALTER TABLE public.vihem_short_stay_common_cleanings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org staff can read common short stay cleanings" ON public.vihem_short_stay_common_cleanings;
CREATE POLICY "Org staff can read common short stay cleanings"
  ON public.vihem_short_stay_common_cleanings FOR SELECT
  TO authenticated
  USING (
    organisation_id = public.get_my_org_id()
    AND public.is_short_stay_enabled(organisation_id)
    AND public.get_my_role() = ANY (ARRAY['staff','admin'])
  );

DROP POLICY IF EXISTS "Org staff can update common short stay cleanings" ON public.vihem_short_stay_common_cleanings;
CREATE POLICY "Org staff can update common short stay cleanings"
  ON public.vihem_short_stay_common_cleanings FOR UPDATE
  TO authenticated
  USING (
    organisation_id = public.get_my_org_id()
    AND public.is_short_stay_enabled(organisation_id)
    AND public.get_my_role() = ANY (ARRAY['staff','admin'])
  )
  WITH CHECK (
    organisation_id = public.get_my_org_id()
    AND public.is_short_stay_enabled(organisation_id)
    AND public.get_my_role() = ANY (ARRAY['staff','admin'])
  );

DROP POLICY IF EXISTS "Admins can create common short stay cleanings" ON public.vihem_short_stay_common_cleanings;
CREATE POLICY "Admins can create common short stay cleanings"
  ON public.vihem_short_stay_common_cleanings FOR INSERT
  TO authenticated
  WITH CHECK (
    organisation_id = public.get_my_org_id()
    AND public.is_short_stay_enabled(organisation_id)
    AND public.get_my_role() = 'admin'
  );

DROP TRIGGER IF EXISTS set_updated_at ON public.vihem_short_stay_common_cleanings;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.vihem_short_stay_common_cleanings
  FOR EACH ROW
  EXECUTE FUNCTION public.vihem_touch_updated_at();
