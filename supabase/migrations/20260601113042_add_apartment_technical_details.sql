/*
  # Apartment Technical Details

  Adds structured technical information fields to the apartments table so
  property managers can record lock cylinders, key IDs, network ports,
  and other operational details per apartment.

  ## New columns on `apartments`

  ### Locks & Access
  - `lock_cylinder_id` (text) — lock cylinder/cylinder ID (e.g. "ASSA 3000 / Cyl-42A")
  - `key_ids` (jsonb array) — list of key objects: [{id, label, copies}]
  - `door_code` (text) — entry code if applicable
  - `mailbox_id` (text) — mailbox number/ID

  ### Network & Utilities
  - `network_outlet_ids` (jsonb array) — [{room, port_id, switch, vlan}]
  - `electricity_fuse_box` (text) — fuse box location and ID
  - `electricity_meter_id` (text) — electricity meter serial/ID
  - `water_meter_id` (text) — water meter serial/ID
  - `heat_meter_id` (text) — heat meter serial/ID
  - `ventilation_unit_id` (text) — ventilation unit reference

  ### Space Details (enriched)
  - `balcony` (boolean) — has balcony/patio
  - `balcony_size` (numeric) — balcony size in m²
  - `storage_id` (text) — storage room ID/number
  - `parking_spot_id` (text) — parking spot number/ID
  - `cellar_id` (text) — cellar storage ID

  ### Internal Notes
  - `technical_notes` (text) — free-text notes for staff
  - `last_renovation_year` (integer) — year of last major renovation
  - `entry_code_updated_at` (timestamptz) — when entry code was last changed
*/

DO $$
BEGIN
  -- Locks & Access
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='apartments' AND column_name='lock_cylinder_id') THEN
    ALTER TABLE apartments ADD COLUMN lock_cylinder_id text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='apartments' AND column_name='key_ids') THEN
    ALTER TABLE apartments ADD COLUMN key_ids jsonb NOT NULL DEFAULT '[]';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='apartments' AND column_name='door_code') THEN
    ALTER TABLE apartments ADD COLUMN door_code text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='apartments' AND column_name='mailbox_id') THEN
    ALTER TABLE apartments ADD COLUMN mailbox_id text NOT NULL DEFAULT '';
  END IF;

  -- Network & Utilities
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='apartments' AND column_name='network_outlet_ids') THEN
    ALTER TABLE apartments ADD COLUMN network_outlet_ids jsonb NOT NULL DEFAULT '[]';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='apartments' AND column_name='electricity_fuse_box') THEN
    ALTER TABLE apartments ADD COLUMN electricity_fuse_box text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='apartments' AND column_name='electricity_meter_id') THEN
    ALTER TABLE apartments ADD COLUMN electricity_meter_id text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='apartments' AND column_name='water_meter_id') THEN
    ALTER TABLE apartments ADD COLUMN water_meter_id text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='apartments' AND column_name='heat_meter_id') THEN
    ALTER TABLE apartments ADD COLUMN heat_meter_id text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='apartments' AND column_name='ventilation_unit_id') THEN
    ALTER TABLE apartments ADD COLUMN ventilation_unit_id text NOT NULL DEFAULT '';
  END IF;

  -- Space details
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='apartments' AND column_name='balcony') THEN
    ALTER TABLE apartments ADD COLUMN balcony boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='apartments' AND column_name='balcony_size') THEN
    ALTER TABLE apartments ADD COLUMN balcony_size numeric NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='apartments' AND column_name='storage_id') THEN
    ALTER TABLE apartments ADD COLUMN storage_id text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='apartments' AND column_name='parking_spot_id') THEN
    ALTER TABLE apartments ADD COLUMN parking_spot_id text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='apartments' AND column_name='cellar_id') THEN
    ALTER TABLE apartments ADD COLUMN cellar_id text NOT NULL DEFAULT '';
  END IF;

  -- Internal
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='apartments' AND column_name='technical_notes') THEN
    ALTER TABLE apartments ADD COLUMN technical_notes text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='apartments' AND column_name='last_renovation_year') THEN
    ALTER TABLE apartments ADD COLUMN last_renovation_year integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='apartments' AND column_name='entry_code_updated_at') THEN
    ALTER TABLE apartments ADD COLUMN entry_code_updated_at timestamptz;
  END IF;
END $$;
