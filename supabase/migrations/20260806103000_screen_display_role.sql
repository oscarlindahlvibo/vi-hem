-- TV-skärmsläge: separat läsroll för organisationsskärmar.

DO $$
BEGIN
  IF to_regclass('public.vihem_profiles') IS NOT NULL THEN
    ALTER TABLE public.vihem_profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
    ALTER TABLE public.vihem_profiles DROP CONSTRAINT IF EXISTS vihem_profiles_role_check;
    ALTER TABLE public.vihem_profiles
      ADD CONSTRAINT vihem_profiles_role_check
      CHECK (role IN ('tenant','staff','admin','superadmin','screen'));
  END IF;
END $$;

DROP POLICY IF EXISTS "Screen can read own org short stay units" ON public.vihem_short_stay_units;
CREATE POLICY "Screen can read own org short stay units"
  ON public.vihem_short_stay_units FOR SELECT
  TO authenticated
  USING (
    organisation_id = public.get_my_org_id()
    AND public.get_my_role() = 'screen'
    AND public.is_short_stay_enabled(organisation_id)
  );

DROP POLICY IF EXISTS "Screen can read own org short stay bookings" ON public.vihem_short_stay_bookings;
CREATE POLICY "Screen can read own org short stay bookings"
  ON public.vihem_short_stay_bookings FOR SELECT
  TO authenticated
  USING (
    organisation_id = public.get_my_org_id()
    AND public.get_my_role() = 'screen'
    AND public.is_short_stay_enabled(organisation_id)
  );

DROP POLICY IF EXISTS "Screen can read own org work orders" ON public.vihem_work_orders;
CREATE POLICY "Screen can read own org work orders"
  ON public.vihem_work_orders FOR SELECT
  TO authenticated
  USING (
    organisation_id = public.get_my_org_id()
    AND public.get_my_role() = 'screen'
  );
