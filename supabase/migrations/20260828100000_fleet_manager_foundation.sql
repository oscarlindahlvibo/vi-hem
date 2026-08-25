-- Fleet Manager: grundarkitektur och datamodell.
--
-- Återanvänder befintliga system istället för att bygga parallella:
--  - Ägande bolag: vihem_companies (redan kopplat till properties/apartments).
--  - Ombord-verktyg/reservdelar: vihem_inventory_locations (type='vehicle')
--    + hela det befintliga inventory-systemet (balances/transactions/RPC) --
--    en fordonsrad får en egen lagerplats, ingen ny lagerlogik behövs.
--  - Arbetsordrar/tidrapportering: vehicle_id läggs till på
--    vihem_work_orders och vihem_time_entries (samma FK-mönster som
--    property_id/customer_project_id redan använder där).
--  - Kostnader: vihem_supplier_invoices.vehicle_id fanns redan som en
--    oconstrainad kolumn (uppenbarligen förberedd för detta) -- FK
--    läggs till här.
--  - Notiser: vihem_notifications + create_notification()/
--    notification_enabled(), samma mönster som Jour-modulen.
--  - Audit: inget levande generellt audit-system finns (vihem_audit_events
--    är oanvänt sedan grundandet) -- bygger en egen omutabel logg
--    (vihem_fleet_events) i samma stil som vihem_inventory_transactions.
--  - Telematik hålls medvetet SEPARAT från stamdata: master-tabeller
--    (vehicles, devices) är vanliga uuid-radtabeller, men
--    vihem_fleet_telematics_readings är en tidsserietabell (bigserial,
--    indexerad på device_id+recorded_at) för att hantera stora datamängder
--    utan att blåsa upp fordonstabellen.

-- ============================================================
-- 1. Modul + notistyp + lagringsbuckets
-- ============================================================

INSERT INTO public.vihem_module_registry
  (module_key, name, description, category, default_enabled, sort_order)
VALUES
  ('fleet_management', 'Fordon', 'Fordon, maskiner och släp -- skador, service, besiktningar, kostnader.', 'operations', false, 130)
ON CONFLICT (module_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  updated_at = now();

ALTER TABLE public.vihem_notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.vihem_notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (
    type IN (
      'info', 'maintenance', 'work_order', 'chat', 'message', 'laundry',
      'news', 'announcement', 'document', 'termination', 'time_entry',
      'absence', 'jour', 'fleet'
    )
  );

UPDATE public.vihem_organisation_notification_settings
SET settings = settings || jsonb_build_object('fleet_damage_reported', true)
WHERE NOT (settings ? 'fleet_damage_reported');

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('vihem-fleet-images', 'vihem-fleet-images', true, 10485760, ARRAY['image/jpeg','image/png','image/webp','image/heic'])
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('vihem-fleet-documents', 'vihem-fleet-documents', true, 20971520, ARRAY['application/pdf','image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Fleet images org access" ON storage.objects;
CREATE POLICY "Fleet images org access" ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'vihem-fleet-images') WITH CHECK (bucket_id = 'vihem-fleet-images');
DROP POLICY IF EXISTS "Fleet documents org access" ON storage.objects;
CREATE POLICY "Fleet documents org access" ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'vihem-fleet-documents') WITH CHECK (bucket_id = 'vihem-fleet-documents');

-- ============================================================
-- 2. Stamdata: fordon/maskiner/släp
-- ============================================================

CREATE TABLE IF NOT EXISTS public.vihem_fleet_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.vihem_companies(id) ON DELETE SET NULL,
  asset_type text NOT NULL DEFAULT 'car' CHECK (asset_type IN ('car','van','truck','trailer','excavator','tractor','implement','other')),
  registration_number text NOT NULL DEFAULT '',
  internal_number text NOT NULL DEFAULT '',
  name text NOT NULL,
  make text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  model_year integer,
  vin text NOT NULL DEFAULT '',
  serial_number text NOT NULL DEFAULT '',
  responsible_user_id uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  property_id uuid REFERENCES public.vihem_properties(id) ON DELETE SET NULL,
  inventory_location_id uuid REFERENCES public.vihem_inventory_locations(id) ON DELETE SET NULL,
  purchase_date date,
  purchase_price numeric(12,2),
  financing_type text NOT NULL DEFAULT 'owned' CHECK (financing_type IN ('owned','leasing','loan','rental')),
  financing_notes text NOT NULL DEFAULT '',
  current_odometer numeric(12,1) NOT NULL DEFAULT 0,
  odometer_unit text NOT NULL DEFAULT 'mil' CHECK (odometer_unit IN ('km','mil')),
  engine_hours numeric(12,1) NOT NULL DEFAULT 0,
  fuel_type text NOT NULL DEFAULT 'diesel' CHECK (fuel_type IN ('petrol','diesel','electric','hybrid','hvo','other')),
  registration_status text NOT NULL DEFAULT 'registered' CHECK (registration_status IN ('registered','deregistered','not_applicable')),
  status text NOT NULL DEFAULT 'in_service' CHECK (status IN ('in_service','workshop','out_of_service','driving_ban','laid_up','rented_out','sold')),
  image_url text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vihem_fleet_vehicles_org_idx ON public.vihem_fleet_vehicles(organisation_id, active, name);
CREATE INDEX IF NOT EXISTS vihem_fleet_vehicles_status_idx ON public.vihem_fleet_vehicles(organisation_id, status);
CREATE INDEX IF NOT EXISTS vihem_fleet_vehicles_reg_idx ON public.vihem_fleet_vehicles(organisation_id, registration_number);

-- ============================================================
-- 3. Koppling till befintliga system
-- ============================================================

ALTER TABLE public.vihem_work_orders ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES public.vihem_fleet_vehicles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS vihem_work_orders_vehicle_idx ON public.vihem_work_orders(vehicle_id);

ALTER TABLE public.vihem_time_entries ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES public.vihem_fleet_vehicles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS vihem_time_entries_vehicle_idx ON public.vihem_time_entries(vehicle_id);

-- vihem_supplier_invoices.vehicle_id fanns redan som en oconstrainad
-- kolumn (uppenbarligen förberedd för Fleet) -- lägg till FK nu när
-- målet finns. Rensa ev. redan lagrade värden som inte pekar på en
-- riktig rad, annars misslyckas FK-tillägget.
UPDATE public.vihem_supplier_invoices SET vehicle_id = NULL
WHERE vehicle_id IS NOT NULL AND vehicle_id NOT IN (SELECT id FROM public.vihem_fleet_vehicles);
ALTER TABLE public.vihem_supplier_invoices
  DROP CONSTRAINT IF EXISTS vihem_supplier_invoices_vehicle_id_fkey;
ALTER TABLE public.vihem_supplier_invoices
  ADD CONSTRAINT vihem_supplier_invoices_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vihem_fleet_vehicles(id) ON DELETE SET NULL;

-- ============================================================
-- 4. Skador och felanmälningar
-- ============================================================

CREATE TABLE IF NOT EXISTS public.vihem_fleet_damage_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vihem_fleet_vehicles(id) ON DELETE CASCADE,
  reported_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  description text NOT NULL DEFAULT '',
  severity text NOT NULL DEFAULT 'should_fix' CHECK (severity IN ('info','should_fix','urgent','no_use')),
  usable boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','converted','resolved','dismissed')),
  work_order_id uuid REFERENCES public.vihem_work_orders(id) ON DELETE SET NULL,
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vihem_fleet_damage_reports_vehicle_idx ON public.vihem_fleet_damage_reports(vehicle_id, status);
CREATE INDEX IF NOT EXISTS vihem_fleet_damage_reports_org_idx ON public.vihem_fleet_damage_reports(organisation_id, status, created_at DESC);

-- ============================================================
-- 5. Service / förebyggande underhåll
-- ============================================================

CREATE TABLE IF NOT EXISTS public.vihem_fleet_service_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vihem_fleet_vehicles(id) ON DELETE CASCADE,
  name text NOT NULL,
  interval_km numeric(12,1),
  interval_hours numeric(12,1),
  interval_months integer,
  last_done_at date,
  last_done_odometer numeric(12,1),
  last_done_hours numeric(12,1),
  next_due_date date,
  next_due_odometer numeric(12,1),
  next_due_hours numeric(12,1),
  active boolean NOT NULL DEFAULT true,
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (interval_km IS NOT NULL OR interval_hours IS NOT NULL OR interval_months IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS vihem_fleet_service_schedules_vehicle_idx ON public.vihem_fleet_service_schedules(vehicle_id, active);

CREATE TABLE IF NOT EXISTS public.vihem_fleet_service_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vihem_fleet_vehicles(id) ON DELETE CASCADE,
  schedule_id uuid REFERENCES public.vihem_fleet_service_schedules(id) ON DELETE SET NULL,
  performed_at date NOT NULL DEFAULT current_date,
  odometer numeric(12,1),
  engine_hours numeric(12,1),
  performed_by_text text NOT NULL DEFAULT '',
  cost numeric(12,2),
  work_order_id uuid REFERENCES public.vihem_work_orders(id) ON DELETE SET NULL,
  description text NOT NULL DEFAULT '',
  documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vihem_fleet_service_records_vehicle_idx ON public.vihem_fleet_service_records(vehicle_id, performed_at DESC);

-- ============================================================
-- 6. Besiktningar och återkommande kontroller (generellt)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.vihem_fleet_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vihem_fleet_vehicles(id) ON DELETE CASCADE,
  inspection_type text NOT NULL,
  interval_months integer,
  last_inspection_date date,
  next_inspection_date date,
  result text CHECK (result IN ('passed','passed_with_remarks','failed')),
  performed_by_text text NOT NULL DEFAULT '',
  cost numeric(12,2),
  document_url text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vihem_fleet_inspections_vehicle_idx ON public.vihem_fleet_inspections(vehicle_id, active);
CREATE INDEX IF NOT EXISTS vihem_fleet_inspections_due_idx ON public.vihem_fleet_inspections(organisation_id, next_inspection_date) WHERE active;

-- ============================================================
-- 7. Mätarställning och maskintimmar (historik)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.vihem_fleet_meter_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vihem_fleet_vehicles(id) ON DELETE CASCADE,
  reading_type text NOT NULL CHECK (reading_type IN ('odometer','engine_hours')),
  value numeric(12,1) NOT NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','telematics','service','import')),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vihem_fleet_meter_readings_vehicle_idx ON public.vihem_fleet_meter_readings(vehicle_id, reading_type, recorded_at DESC);

-- ============================================================
-- 8. Däck
-- ============================================================

CREATE TABLE IF NOT EXISTS public.vihem_fleet_tires (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vihem_fleet_vehicles(id) ON DELETE CASCADE,
  season text NOT NULL DEFAULT 'summer' CHECK (season IN ('summer','winter','all_season')),
  dimension text NOT NULL DEFAULT '',
  brand text NOT NULL DEFAULT '',
  dot text NOT NULL DEFAULT '',
  tread_depth_mm numeric(4,1),
  position text CHECK (position IN ('front_left','front_right','rear_left','rear_right','spare','storage')),
  mounted boolean NOT NULL DEFAULT false,
  storage_location text NOT NULL DEFAULT '',
  mounted_at date,
  mounted_odometer numeric(12,1),
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vihem_fleet_tires_vehicle_idx ON public.vihem_fleet_tires(vehicle_id);

-- ============================================================
-- 9. Kostnader
-- ============================================================

CREATE TABLE IF NOT EXISTS public.vihem_fleet_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vihem_fleet_vehicles(id) ON DELETE CASCADE,
  cost_type text NOT NULL CHECK (cost_type IN ('service','repair','parts','tires','insurance','tax','leasing','inspection','fuel','charging','other')),
  amount numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'SEK',
  cost_date date NOT NULL DEFAULT current_date,
  description text NOT NULL DEFAULT '',
  work_order_id uuid REFERENCES public.vihem_work_orders(id) ON DELETE SET NULL,
  supplier_invoice_id uuid REFERENCES public.vihem_supplier_invoices(id) ON DELETE SET NULL,
  service_record_id uuid REFERENCES public.vihem_fleet_service_records(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vihem_fleet_costs_vehicle_idx ON public.vihem_fleet_costs(vehicle_id, cost_date DESC);

-- ============================================================
-- 10. Checklistor (generellt mall-system -- fanns inte innan)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.vihem_fleet_checklist_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  asset_type text CHECK (asset_type IN ('car','van','truck','trailer','excavator','tractor','implement','other')),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vihem_fleet_checklist_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.vihem_fleet_checklist_templates(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vihem_fleet_checklist_template_items_idx ON public.vihem_fleet_checklist_template_items(template_id, sort_order);

CREATE TABLE IF NOT EXISTS public.vihem_fleet_checklist_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vihem_fleet_vehicles(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.vihem_fleet_checklist_templates(id) ON DELETE SET NULL,
  template_name_snapshot text NOT NULL DEFAULT '',
  performed_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  performed_at timestamptz NOT NULL DEFAULT now(),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vihem_fleet_checklist_runs_vehicle_idx ON public.vihem_fleet_checklist_runs(vehicle_id, performed_at DESC);

CREATE TABLE IF NOT EXISTS public.vihem_fleet_checklist_run_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.vihem_fleet_checklist_runs(id) ON DELETE CASCADE,
  label_snapshot text NOT NULL,
  ok boolean NOT NULL DEFAULT true,
  damage_report_id uuid REFERENCES public.vihem_fleet_damage_reports(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vihem_fleet_checklist_run_items_idx ON public.vihem_fleet_checklist_run_items(run_id);

-- ============================================================
-- 11. Telematik: provider/device-lager + separat tidsseriedata
-- ============================================================

CREATE TABLE IF NOT EXISTS public.vihem_fleet_telematics_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES public.vihem_fleet_vehicles(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'teltonika' CHECK (provider IN ('teltonika','generic_obd','generic_gps','other')),
  device_model text NOT NULL DEFAULT '',
  imei text NOT NULL DEFAULT '',
  sim_number text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'unknown' CHECK (status IN ('online','offline','unknown')),
  last_contact_at timestamptz,
  api_key text NOT NULL DEFAULT replace((gen_random_uuid()::text || gen_random_uuid()::text), '-', ''),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, imei)
);
CREATE UNIQUE INDEX IF NOT EXISTS vihem_fleet_telematics_devices_api_key_idx ON public.vihem_fleet_telematics_devices(api_key);
CREATE INDEX IF NOT EXISTS vihem_fleet_telematics_devices_vehicle_idx ON public.vihem_fleet_telematics_devices(vehicle_id);

CREATE TABLE IF NOT EXISTS public.vihem_fleet_telematics_device_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES public.vihem_fleet_telematics_devices(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vihem_fleet_vehicles(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  unassigned_at timestamptz,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS vihem_fleet_telematics_device_assignments_idx ON public.vihem_fleet_telematics_device_assignments(vehicle_id, assigned_at DESC);

-- Tidsseriedata: bigserial (inte uuid) för billigare index vid höga
-- volymer, ingen organisation_id/RLS-per-rad -- åtkomst styrs via
-- device_id -> vehicle_id -> vehicles-RLS i frontend-frågor (SELECT
-- alltid join:ad mot devices/vehicles). Rensas inte automatiskt här --
-- lämnat som ett känt kvarstående (se docs/fleet.md).
CREATE TABLE IF NOT EXISTS public.vihem_fleet_telematics_readings (
  id bigserial PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES public.vihem_fleet_telematics_devices(id) ON DELETE CASCADE,
  recorded_at timestamptz NOT NULL,
  latitude double precision,
  longitude double precision,
  speed_kmh numeric(6,1),
  heading numeric(5,1),
  ignition boolean,
  odometer numeric(12,1),
  engine_rpm integer,
  fuel_level_pct numeric(5,1),
  battery_voltage numeric(5,2),
  engine_hours numeric(12,1),
  signal_quality integer,
  source text NOT NULL DEFAULT 'device',
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vihem_fleet_telematics_readings_device_idx ON public.vihem_fleet_telematics_readings(device_id, recorded_at DESC);

-- Resor -- datamodell förberedd, ingen härledningslogik/UI i denna version.
CREATE TABLE IF NOT EXISTS public.vihem_fleet_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vihem_fleet_vehicles(id) ON DELETE CASCADE,
  device_id uuid REFERENCES public.vihem_fleet_telematics_devices(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  start_latitude double precision,
  start_longitude double precision,
  end_latitude double precision,
  end_longitude double precision,
  start_address text NOT NULL DEFAULT '',
  end_address text NOT NULL DEFAULT '',
  distance_km numeric(8,1),
  purpose text NOT NULL DEFAULT 'unknown' CHECK (purpose IN ('business','private','unknown')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vihem_fleet_trips_vehicle_idx ON public.vihem_fleet_trips(vehicle_id, started_at DESC);

-- ============================================================
-- 12. Historik/audit (omutabel logg per fordon)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.vihem_fleet_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vihem_fleet_vehicles(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('created','status_changed','odometer_updated','damage_reported','damage_converted','work_order_created','inspection_recorded','service_recorded','device_assigned','device_unassigned','updated')),
  summary text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vihem_fleet_events_vehicle_idx ON public.vihem_fleet_events(vehicle_id, created_at DESC);

NOTIFY pgrst, 'reload schema';
