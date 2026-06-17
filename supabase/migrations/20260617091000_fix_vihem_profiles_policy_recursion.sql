/*
  # Fix VI-HEM profile policy recursion

  Replaces a profile read policy that selected from vihem_profiles inside a
  vihem_profiles policy expression. The replacement uses SECURITY DEFINER helper
  functions so profile lookup during login does not recurse through RLS.
*/

DO $$
BEGIN
  IF to_regclass('public.vihem_profiles') IS NOT NULL THEN
    DROP POLICY IF EXISTS "VIHEM staff can read org profiles" ON public.vihem_profiles;

    CREATE POLICY "VIHEM staff can read org profiles"
      ON public.vihem_profiles FOR SELECT
      TO authenticated
      USING (
        public.vihem_get_my_role() = 'superadmin'
        OR (
          public.vihem_get_my_role() IN ('staff', 'admin')
          AND organisation_id = public.vihem_get_my_org_id()
        )
      );
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
