/*
  # Korttid: kanalkoder för långtidsrabatter (prisnivå 2-4 i Beds24)

  VI-HEM styr rabatter för längre vistelser genom att skicka extra prisnivåer
  till Beds24 (price2 = 2+ nätter, price3 = 7+ nätter, price4 = 28+ nätter),
  som Beds24 skickar vidare som egna prisalternativ ("rate plans") till
  kanalerna. Varje prisalternativ i en kanal har ett kanalspecifikt id
  (Booking.com: rate plan-id, Expedia: rate plan-id per rumstyp) som måste
  kopplas till rätt prisnivå och enhet. Den kopplingen ligger här.
*/
CREATE TABLE IF NOT EXISTS public.vihem_short_stay_channel_rate_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.vihem_short_stay_units(id) ON DELETE CASCADE,
  level integer NOT NULL CHECK (level IN (2, 3, 4)),
  channel text NOT NULL CHECK (channel IN ('booking', 'expedia')),
  rate_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, level, channel)
);

ALTER TABLE public.vihem_short_stay_channel_rate_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage short stay channel rate codes"
  ON public.vihem_short_stay_channel_rate_codes FOR ALL
  USING (organisation_id = get_my_org_id() AND is_short_stay_enabled(organisation_id) AND get_my_role() = 'admin')
  WITH CHECK (organisation_id = get_my_org_id() AND is_short_stay_enabled(organisation_id) AND get_my_role() = 'admin');

CREATE POLICY "Org staff can read short stay channel rate codes"
  ON public.vihem_short_stay_channel_rate_codes FOR SELECT
  USING (organisation_id = get_my_org_id() AND is_short_stay_enabled(organisation_id) AND get_my_role() IN ('staff', 'admin'));

CREATE POLICY "Superadmins can read short stay channel rate codes"
  ON public.vihem_short_stay_channel_rate_codes FOR SELECT
  USING (get_my_role() = 'superadmin');
