ALTER TABLE public.vihem_laundry_bookings
  ALTER COLUMN tenant_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS guest_link_id uuid REFERENCES public.vihem_laundry_guest_links(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS guest_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS guest_email text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS guest_phone text NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'vihem_laundry_bookings_actor_check'
      AND conrelid = 'public.vihem_laundry_bookings'::regclass
  ) THEN
    ALTER TABLE public.vihem_laundry_bookings
      ADD CONSTRAINT vihem_laundry_bookings_actor_check
      CHECK (tenant_id IS NOT NULL OR guest_link_id IS NOT NULL);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS vihem_laundry_bookings_one_active_per_slot
  ON public.vihem_laundry_bookings(laundry_slot_id)
  WHERE status = 'active';

NOTIFY pgrst, 'reload schema';
