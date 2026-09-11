-- vihem_apartments and vihem_properties had RLS enabled with SELECT/INSERT/UPDATE
-- policies but no DELETE policy at all, so an admin's DELETE silently matched
-- zero rows (no error, no effect) instead of deleting anything.
DROP POLICY IF EXISTS "Admin can delete own org apartments" ON public.vihem_apartments;
CREATE POLICY "Admin can delete own org apartments" ON public.vihem_apartments
  FOR DELETE
  USING (get_my_role() = 'admin' AND organisation_id = get_my_org_id());

DROP POLICY IF EXISTS "Admin can delete own org properties" ON public.vihem_properties;
CREATE POLICY "Admin can delete own org properties" ON public.vihem_properties
  FOR DELETE
  USING (get_my_role() = 'admin' AND organisation_id = get_my_org_id());
