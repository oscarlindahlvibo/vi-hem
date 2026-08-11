-- Publik tenant-mappning och abstrakt access-provider för ViboRent.
CREATE TABLE IF NOT EXISTS public.vihem_rental_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  hostname text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hostname)
);

CREATE TABLE IF NOT EXISTS public.vihem_rental_access_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.vihem_rental_bookings(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.vihem_rental_assets(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_device_id text NOT NULL DEFAULT '',
  external_credential_id text NOT NULL DEFAULT '',
  credential text NOT NULL DEFAULT '',
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked','failed')),
  last_error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vihem_rental_domains_org_idx ON public.vihem_rental_domains(organisation_id, active);
CREATE INDEX IF NOT EXISTS vihem_rental_access_booking_idx ON public.vihem_rental_access_credentials(organisation_id, booking_id, status);

ALTER TABLE public.vihem_rental_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_rental_access_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Rental domains admin" ON public.vihem_rental_domains;
CREATE POLICY "Rental domains admin" ON public.vihem_rental_domains FOR ALL TO authenticated
  USING (organisation_id = public.get_my_org_id() AND public.get_my_role() = 'admin' AND public.vihem_rental_enabled(organisation_id))
  WITH CHECK (organisation_id = public.get_my_org_id() AND public.get_my_role() = 'admin' AND public.vihem_rental_enabled(organisation_id));

DROP POLICY IF EXISTS "Rental access staff" ON public.vihem_rental_access_credentials;
CREATE POLICY "Rental access staff" ON public.vihem_rental_access_credentials FOR SELECT TO authenticated
  USING (organisation_id = public.get_my_org_id() AND public.vihem_rental_enabled(organisation_id));

DROP POLICY IF EXISTS "Rental access admin" ON public.vihem_rental_access_credentials;
CREATE POLICY "Rental access admin" ON public.vihem_rental_access_credentials FOR ALL TO authenticated
  USING (organisation_id = public.get_my_org_id() AND public.get_my_role() = 'admin' AND public.vihem_rental_enabled(organisation_id))
  WITH CHECK (organisation_id = public.get_my_org_id() AND public.get_my_role() = 'admin' AND public.vihem_rental_enabled(organisation_id));

NOTIFY pgrst, 'reload schema';
