-- The TV screen's "Instämplade just nu" panel (ScreenDisplayPage.tsx)
-- fetches vihem_time_entries (WHERE end_time IS NULL) and embeds
-- user:vihem_profiles(id, name, email) for each -- but no RLS policy has
-- ever granted role='screen' SELECT on either table (only work_orders,
-- laundry and short-stay data got a screen policy when that role was
-- introduced, 20260806103000_screen_display_role.sql). RLS silently
-- returns zero rows rather than erroring, so the panel just renders "Ingen
-- är instämplad just nu." -- looking broken rather than throwing.
DROP POLICY IF EXISTS "Screen can read own org time entries" ON public.vihem_time_entries;
CREATE POLICY "Screen can read own org time entries" ON public.vihem_time_entries
  FOR SELECT TO authenticated
  USING (organisation_id = get_my_org_id() AND get_my_role() = 'screen');

DROP POLICY IF EXISTS "Screen can read own org profiles" ON public.vihem_profiles;
CREATE POLICY "Screen can read own org profiles" ON public.vihem_profiles
  FOR SELECT TO authenticated
  USING (organisation_id = get_my_org_id() AND get_my_role() = 'screen');

NOTIFY pgrst, 'reload schema';
