CREATE TABLE IF NOT EXISTS public.vihem_laundry_guest_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.vihem_properties(id) ON DELETE CASCADE,
  apartment_id uuid REFERENCES public.vihem_apartments(id) ON DELETE SET NULL,
  short_stay_unit_id uuid REFERENCES public.vihem_short_stay_units(id) ON DELETE SET NULL,
  label text NOT NULL DEFAULT '',
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  active boolean NOT NULL DEFAULT true,
  valid_from date,
  valid_until date,
  max_bookings integer NOT NULL DEFAULT 3,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vihem_laundry_guest_links_max_bookings_check CHECK (max_bookings BETWEEN 1 AND 10),
  CONSTRAINT vihem_laundry_guest_links_dates_check CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from)
);

ALTER TABLE public.vihem_laundry_bookings
  ALTER COLUMN tenant_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS guest_link_id uuid REFERENCES public.vihem_laundry_guest_links(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS guest_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS guest_email text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS guest_phone text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS vihem_laundry_bookings_one_active_per_slot
  ON public.vihem_laundry_bookings(laundry_slot_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_vihem_laundry_guest_links_org
  ON public.vihem_laundry_guest_links(organisation_id);
CREATE INDEX IF NOT EXISTS idx_vihem_laundry_guest_links_property
  ON public.vihem_laundry_guest_links(property_id);
CREATE INDEX IF NOT EXISTS idx_vihem_laundry_bookings_guest_link
  ON public.vihem_laundry_bookings(guest_link_id);

ALTER TABLE public.vihem_laundry_guest_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage laundry guest links" ON public.vihem_laundry_guest_links;
CREATE POLICY "Admins can manage laundry guest links"
  ON public.vihem_laundry_guest_links
  FOR ALL
  TO authenticated
  USING (
    public.vihem_is_admin()
    AND (
      public.vihem_get_my_role() = 'superadmin'
      OR organisation_id = public.vihem_get_my_org_id()
    )
  )
  WITH CHECK (
    public.vihem_is_admin()
    AND (
      public.vihem_get_my_role() = 'superadmin'
      OR organisation_id = public.vihem_get_my_org_id()
    )
  );

DROP POLICY IF EXISTS "Staff can read laundry guest links" ON public.vihem_laundry_guest_links;
CREATE POLICY "Staff can read laundry guest links"
  ON public.vihem_laundry_guest_links
  FOR SELECT
  TO authenticated
  USING (
    public.vihem_is_staff()
    AND (
      public.vihem_get_my_role() = 'superadmin'
      OR organisation_id = public.vihem_get_my_org_id()
    )
  );

NOTIFY pgrst, 'reload schema';
