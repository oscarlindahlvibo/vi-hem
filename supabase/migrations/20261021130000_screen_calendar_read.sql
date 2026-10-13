BEGIN;
-- TV devices may read shared calendar entries, never personal/selected entries.
-- Existing staff/admin policies and all write policies are unchanged.
DROP POLICY IF EXISTS "VIHEM screen reads organisation calendar" ON public.vihem_calendar_events;
CREATE POLICY "VIHEM screen reads organisation calendar"
  ON public.vihem_calendar_events FOR SELECT TO authenticated
  USING (
    visibility = 'organisation'
    AND organisation_id = public.vihem_get_my_org_id()
    AND public.vihem_get_my_role() = 'screen'
    AND EXISTS (
      SELECT 1 FROM public.vihem_profiles p
      WHERE p.id = auth.uid() AND p.organisation_id = vihem_calendar_events.organisation_id
        AND p.role = 'screen' AND p.active = true
    )
  );
COMMIT;
