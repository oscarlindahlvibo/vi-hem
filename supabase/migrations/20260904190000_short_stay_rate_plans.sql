-- Priskalender + rabattregler per rum/lägenhet för korttidsuthyrning:
-- säsonger (namngivna datumintervall), grundpris per natt per enhet+säsong,
-- och längd-på-vistelse-rabattnivåer (t.ex. billigare från natt 2 på
-- lågsäsong, ännu billigare vid en vecka/månad). Rent tilläggsschema --
-- rör inte vihem_short_stay_units eller befintlig bokningslogik.

CREATE TABLE IF NOT EXISTS public.vihem_short_stay_seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  -- Vid överlappande säsonger (borde undvikas, men inte hårt förbjudet)
  -- vinner den med högst priority för ett givet datum.
  priority integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vihem_short_stay_seasons_date_range CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_vihem_short_stay_seasons_org ON public.vihem_short_stay_seasons(organisation_id);
CREATE INDEX IF NOT EXISTS idx_vihem_short_stay_seasons_dates ON public.vihem_short_stay_seasons(organisation_id, start_date, end_date);

-- Grundpris per natt, per enhet. season_id NULL = standardpris (används
-- för datum som inte täcks av någon säsong).
CREATE TABLE IF NOT EXISTS public.vihem_short_stay_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.vihem_short_stay_units(id) ON DELETE CASCADE,
  season_id uuid REFERENCES public.vihem_short_stay_seasons(id) ON DELETE CASCADE,
  price_per_night numeric(10,2) NOT NULL CHECK (price_per_night >= 0),
  currency text NOT NULL DEFAULT 'SEK',
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, season_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vihem_short_stay_rates_unit_default
  ON public.vihem_short_stay_rates(unit_id) WHERE season_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_vihem_short_stay_rates_org ON public.vihem_short_stay_rates(organisation_id);

-- Rabattnivåer baserat på vistelsens längd. season_id NULL = gäller när
-- ingen säsongsspecifik nivå finns för samma unit_id/min_nights-tröskel.
-- Den nivå med högst min_nights som är <= faktiskt antal nätter vinner
-- (ej kumulativt).
CREATE TABLE IF NOT EXISTS public.vihem_short_stay_los_discounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.vihem_short_stay_units(id) ON DELETE CASCADE,
  season_id uuid REFERENCES public.vihem_short_stay_seasons(id) ON DELETE CASCADE,
  min_nights integer NOT NULL CHECK (min_nights >= 1),
  discount_percent numeric(5,2) NOT NULL CHECK (discount_percent >= 0 AND discount_percent <= 100),
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, season_id, min_nights)
);
CREATE INDEX IF NOT EXISTS idx_vihem_short_stay_los_discounts_org ON public.vihem_short_stay_los_discounts(organisation_id);

-- Håller reda på senaste utskicket till Beds24 per enhet, så UI:t kan visa
-- "senast synkad" och fel utan att behöva fråga Beds24 direkt.
CREATE TABLE IF NOT EXISTS public.vihem_short_stay_price_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  unit_id uuid REFERENCES public.vihem_short_stay_units(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('ok','failed')),
  message text NOT NULL DEFAULT '',
  days_synced integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vihem_short_stay_price_sync_log_org ON public.vihem_short_stay_price_sync_log(organisation_id, created_at DESC);

ALTER TABLE public.vihem_short_stay_seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_short_stay_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_short_stay_los_discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_short_stay_price_sync_log ENABLE ROW LEVEL SECURITY;

-- Samma mönster som vihem_short_stay_units: staff läser, admin hanterar,
-- allt portat bakom is_short_stay_enabled(organisation_id).
CREATE POLICY "Org staff can read short stay seasons" ON public.vihem_short_stay_seasons FOR SELECT
  USING (organisation_id = get_my_org_id() AND is_short_stay_enabled(organisation_id) AND get_my_role() IN ('staff','admin'));
CREATE POLICY "Superadmins can read short stay seasons" ON public.vihem_short_stay_seasons FOR SELECT
  USING (get_my_role() = 'superadmin');
CREATE POLICY "Admins can manage short stay seasons" ON public.vihem_short_stay_seasons FOR ALL
  USING (organisation_id = get_my_org_id() AND is_short_stay_enabled(organisation_id) AND get_my_role() = 'admin')
  WITH CHECK (organisation_id = get_my_org_id() AND is_short_stay_enabled(organisation_id) AND get_my_role() = 'admin');

CREATE POLICY "Org staff can read short stay rates" ON public.vihem_short_stay_rates FOR SELECT
  USING (organisation_id = get_my_org_id() AND is_short_stay_enabled(organisation_id) AND get_my_role() IN ('staff','admin'));
CREATE POLICY "Superadmins can read short stay rates" ON public.vihem_short_stay_rates FOR SELECT
  USING (get_my_role() = 'superadmin');
CREATE POLICY "Admins can manage short stay rates" ON public.vihem_short_stay_rates FOR ALL
  USING (organisation_id = get_my_org_id() AND is_short_stay_enabled(organisation_id) AND get_my_role() = 'admin')
  WITH CHECK (organisation_id = get_my_org_id() AND is_short_stay_enabled(organisation_id) AND get_my_role() = 'admin');

CREATE POLICY "Org staff can read short stay los discounts" ON public.vihem_short_stay_los_discounts FOR SELECT
  USING (organisation_id = get_my_org_id() AND is_short_stay_enabled(organisation_id) AND get_my_role() IN ('staff','admin'));
CREATE POLICY "Superadmins can read short stay los discounts" ON public.vihem_short_stay_los_discounts FOR SELECT
  USING (get_my_role() = 'superadmin');
CREATE POLICY "Admins can manage short stay los discounts" ON public.vihem_short_stay_los_discounts FOR ALL
  USING (organisation_id = get_my_org_id() AND is_short_stay_enabled(organisation_id) AND get_my_role() = 'admin')
  WITH CHECK (organisation_id = get_my_org_id() AND is_short_stay_enabled(organisation_id) AND get_my_role() = 'admin');

CREATE POLICY "Org staff can read short stay price sync log" ON public.vihem_short_stay_price_sync_log FOR SELECT
  USING (organisation_id = get_my_org_id() AND is_short_stay_enabled(organisation_id) AND get_my_role() IN ('staff','admin'));
CREATE POLICY "Superadmins can read short stay price sync log" ON public.vihem_short_stay_price_sync_log FOR SELECT
  USING (get_my_role() = 'superadmin');

NOTIFY pgrst, 'reload schema';
