DO $$
BEGIN
  IF to_regclass('public.vihem_screen_settings') IS NOT NULL THEN
    ALTER TABLE public.vihem_screen_settings
      DROP CONSTRAINT IF EXISTS vihem_screen_settings_screen_view_check;

    ALTER TABLE public.vihem_screen_settings
      ADD CONSTRAINT vihem_screen_settings_screen_view_check
      CHECK (screen_view IN ('short-stay', 'work-orders', 'presentation', 'laundry'));
  END IF;
END $$;

DROP POLICY IF EXISTS "Screen can read own org laundry rooms" ON public.vihem_laundry_rooms;
CREATE POLICY "Screen can read own org laundry rooms"
  ON public.vihem_laundry_rooms
  FOR SELECT
  TO authenticated
  USING (
    organisation_id = public.get_my_org_id()
    AND public.get_my_role() = 'screen'
  );

DROP POLICY IF EXISTS "Screen can read own org laundry slots" ON public.vihem_laundry_slots;
CREATE POLICY "Screen can read own org laundry slots"
  ON public.vihem_laundry_slots
  FOR SELECT
  TO authenticated
  USING (
    public.get_my_role() = 'screen'
    AND laundry_room_id IN (
      SELECT id
      FROM public.vihem_laundry_rooms
      WHERE organisation_id = public.get_my_org_id()
    )
  );

DROP POLICY IF EXISTS "Screen can read own org laundry bookings" ON public.vihem_laundry_bookings;
CREATE POLICY "Screen can read own org laundry bookings"
  ON public.vihem_laundry_bookings
  FOR SELECT
  TO authenticated
  USING (
    public.get_my_role() = 'screen'
    AND laundry_slot_id IN (
      SELECT slot.id
      FROM public.vihem_laundry_slots slot
      JOIN public.vihem_laundry_rooms room ON room.id = slot.laundry_room_id
      WHERE room.organisation_id = public.get_my_org_id()
    )
  );
