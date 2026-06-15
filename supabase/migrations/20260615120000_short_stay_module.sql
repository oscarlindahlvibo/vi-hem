-- Korttidsuthyrning module

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS short_stay_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_short_stay_units integer NOT NULL DEFAULT 3;

CREATE OR REPLACE FUNCTION is_short_stay_enabled(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE((
    SELECT short_stay_enabled
    FROM organisations
    WHERE id = org_id
      AND active = true
  ), false);
$$;

CREATE TABLE IF NOT EXISTS short_stay_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
  apartment_id uuid REFERENCES apartments(id) ON DELETE SET NULL,
  name text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  ical_url_1 text NOT NULL DEFAULT '',
  channel_name_1 text NOT NULL DEFAULT 'Booking.com',
  ical_url_2 text NOT NULL DEFAULT '',
  channel_name_2 text NOT NULL DEFAULT 'Expedia / Hotels.com',
  ical_url_3 text NOT NULL DEFAULT '',
  channel_name_3 text NOT NULL DEFAULT 'Airbnb',
  ical_token text NOT NULL DEFAULT encode(gen_random_bytes(18), 'hex') UNIQUE,
  last_synced_at timestamptz,
  sync_error_1 text,
  sync_error_2 text,
  sync_error_3 text,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS short_stay_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES short_stay_units(id) ON DELETE CASCADE,
  external_uid text,
  channel_number integer CHECK (channel_number IN (1, 2, 3) OR channel_number IS NULL),
  channel_name text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  start_date date NOT NULL,
  end_date date NOT NULL,
  is_manual boolean NOT NULL DEFAULT false,
  booking_type text NOT NULL DEFAULT 'booking' CHECK (booking_type IN ('booking', 'block')),
  guest_name text NOT NULL DEFAULT '',
  guest_email text NOT NULL DEFAULT '',
  guest_phone text NOT NULL DEFAULT '',
  guest_count integer NOT NULL DEFAULT 1,
  payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
  cleaning_status text NOT NULL DEFAULT 'dirty' CHECK (cleaning_status IN ('not_needed', 'dirty', 'in_progress', 'clean')),
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT short_stay_booking_dates_check CHECK (end_date > start_date),
  CONSTRAINT short_stay_bookings_external_unique UNIQUE (unit_id, external_uid)
);

CREATE INDEX IF NOT EXISTS idx_short_stay_units_org ON short_stay_units(organisation_id);
CREATE INDEX IF NOT EXISTS idx_short_stay_units_property ON short_stay_units(property_id);
CREATE INDEX IF NOT EXISTS idx_short_stay_bookings_org ON short_stay_bookings(organisation_id);
CREATE INDEX IF NOT EXISTS idx_short_stay_bookings_unit ON short_stay_bookings(unit_id);
CREATE INDEX IF NOT EXISTS idx_short_stay_bookings_dates ON short_stay_bookings(start_date, end_date);

ALTER TABLE short_stay_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE short_stay_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org staff can read short stay units" ON short_stay_units;
CREATE POLICY "Org staff can read short stay units"
  ON short_stay_units FOR SELECT
  TO authenticated
  USING (
    organisation_id = get_my_org_id()
    AND is_short_stay_enabled(organisation_id)
    AND get_my_role() = ANY (ARRAY['staff','admin'])
  );

DROP POLICY IF EXISTS "Superadmins can read short stay units" ON short_stay_units;
CREATE POLICY "Superadmins can read short stay units"
  ON short_stay_units FOR SELECT
  TO authenticated
  USING (get_my_role() = 'superadmin');

DROP POLICY IF EXISTS "Admins can manage short stay units" ON short_stay_units;
CREATE POLICY "Admins can manage short stay units"
  ON short_stay_units FOR ALL
  TO authenticated
  USING (
    organisation_id = get_my_org_id()
    AND is_short_stay_enabled(organisation_id)
    AND get_my_role() = 'admin'
  )
  WITH CHECK (
    organisation_id = get_my_org_id()
    AND is_short_stay_enabled(organisation_id)
    AND get_my_role() = 'admin'
  );

DROP POLICY IF EXISTS "Org staff can read short stay bookings" ON short_stay_bookings;
CREATE POLICY "Org staff can read short stay bookings"
  ON short_stay_bookings FOR SELECT
  TO authenticated
  USING (
    organisation_id = get_my_org_id()
    AND is_short_stay_enabled(organisation_id)
    AND get_my_role() = ANY (ARRAY['staff','admin'])
  );

DROP POLICY IF EXISTS "Superadmins can read short stay bookings" ON short_stay_bookings;
CREATE POLICY "Superadmins can read short stay bookings"
  ON short_stay_bookings FOR SELECT
  TO authenticated
  USING (get_my_role() = 'superadmin');

DROP POLICY IF EXISTS "Org staff can manage short stay bookings" ON short_stay_bookings;
CREATE POLICY "Org staff can manage short stay bookings"
  ON short_stay_bookings FOR ALL
  TO authenticated
  USING (
    organisation_id = get_my_org_id()
    AND is_short_stay_enabled(organisation_id)
    AND get_my_role() = ANY (ARRAY['staff','admin'])
  )
  WITH CHECK (
    organisation_id = get_my_org_id()
    AND is_short_stay_enabled(organisation_id)
    AND get_my_role() = ANY (ARRAY['staff','admin'])
    AND EXISTS (
      SELECT 1
      FROM short_stay_units ssu
      WHERE ssu.id = short_stay_bookings.unit_id
        AND ssu.organisation_id = short_stay_bookings.organisation_id
    )
  );
