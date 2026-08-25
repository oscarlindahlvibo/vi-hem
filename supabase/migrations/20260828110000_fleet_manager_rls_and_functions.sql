-- Fleet Manager: RLS-policyer + hjälpfunktioner.
--
-- Behörighetsmodell (matchar avsnitt 20 i kravspecen exakt):
--  - Personal: ser fordon, rapporterar skador, genomför kontroller
--    (besiktningar/checklistor), rapporterar mätarställning/service.
--  - Admin/superadmin: skapar/redigerar fordon, ändrar serviceintervall,
--    administrerar besiktningar/checklistmallar/telematikenheter, ser
--    kostnader.
-- Kostnader är den enda tabellen där personal INTE har SELECT --
-- resten av modulen följer samma "org-brett, rollbaserat" mönster som
-- redan gäller för arbetsordrar (ingen per-tillgång-ACL finns någon
-- annanstans i kodbasen att bygga vidare på).

ALTER TABLE public.vihem_fleet_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_fleet_damage_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_fleet_service_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_fleet_service_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_fleet_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_fleet_meter_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_fleet_tires ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_fleet_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_fleet_checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_fleet_checklist_template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_fleet_checklist_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_fleet_checklist_run_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_fleet_telematics_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_fleet_telematics_device_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_fleet_telematics_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_fleet_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_fleet_events ENABLE ROW LEVEL SECURITY;

-- ---- Fordon ----
DROP POLICY IF EXISTS "Fleet vehicles org read" ON public.vihem_fleet_vehicles;
CREATE POLICY "Fleet vehicles org read" ON public.vihem_fleet_vehicles FOR SELECT TO authenticated
USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_module_enabled('fleet_management'));
DROP POLICY IF EXISTS "Fleet vehicles admin write" ON public.vihem_fleet_vehicles;
CREATE POLICY "Fleet vehicles admin write" ON public.vihem_fleet_vehicles FOR ALL TO authenticated
USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin','superadmin') AND public.vihem_module_enabled('fleet_management'))
WITH CHECK (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin','superadmin') AND public.vihem_module_enabled('fleet_management'));

-- ---- Generell hjälp: staff+admin läs/skriv, admin-only radera, för de
-- "operativa loggnings"-tabellerna (skador, service, besiktningar,
-- mätarställning, däck, checklistkörningar) ----
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'vihem_fleet_damage_reports','vihem_fleet_service_records','vihem_fleet_inspections',
    'vihem_fleet_meter_readings','vihem_fleet_tires','vihem_fleet_checklist_runs'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Fleet staff read %s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "Fleet staff read %s" ON public.%I FOR SELECT TO authenticated USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_module_enabled(''fleet_management''))', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Fleet staff insert %s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "Fleet staff insert %s" ON public.%I FOR INSERT TO authenticated WITH CHECK (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN (''staff'',''admin'',''superadmin'') AND public.vihem_module_enabled(''fleet_management''))', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Fleet staff update %s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "Fleet staff update %s" ON public.%I FOR UPDATE TO authenticated USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN (''staff'',''admin'',''superadmin'') AND public.vihem_module_enabled(''fleet_management'')) WITH CHECK (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN (''staff'',''admin'',''superadmin'') AND public.vihem_module_enabled(''fleet_management''))', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Fleet admin delete %s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "Fleet admin delete %s" ON public.%I FOR DELETE TO authenticated USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN (''admin'',''superadmin''))', t, t);
  END LOOP;
END $$;

-- ---- Serviceintervall: admin-only (strukturell konfiguration) ----
DROP POLICY IF EXISTS "Fleet service schedules read" ON public.vihem_fleet_service_schedules;
CREATE POLICY "Fleet service schedules read" ON public.vihem_fleet_service_schedules FOR SELECT TO authenticated
USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_module_enabled('fleet_management'));
DROP POLICY IF EXISTS "Fleet service schedules admin write" ON public.vihem_fleet_service_schedules;
CREATE POLICY "Fleet service schedules admin write" ON public.vihem_fleet_service_schedules FOR ALL TO authenticated
USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin','superadmin') AND public.vihem_module_enabled('fleet_management'))
WITH CHECK (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin','superadmin') AND public.vihem_module_enabled('fleet_management'));

-- ---- Kostnader: admin/superadmin ENDAST (personal ser inte kostnader) ----
DROP POLICY IF EXISTS "Fleet costs admin only" ON public.vihem_fleet_costs;
CREATE POLICY "Fleet costs admin only" ON public.vihem_fleet_costs FOR ALL TO authenticated
USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin','superadmin') AND public.vihem_module_enabled('fleet_management'))
WITH CHECK (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin','superadmin') AND public.vihem_module_enabled('fleet_management'));

-- ---- Checklistmallar: personal läser (för att kunna genomföra),
-- admin administrerar ----
DROP POLICY IF EXISTS "Fleet checklist templates read" ON public.vihem_fleet_checklist_templates;
CREATE POLICY "Fleet checklist templates read" ON public.vihem_fleet_checklist_templates FOR SELECT TO authenticated
USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_module_enabled('fleet_management'));
DROP POLICY IF EXISTS "Fleet checklist templates admin write" ON public.vihem_fleet_checklist_templates;
CREATE POLICY "Fleet checklist templates admin write" ON public.vihem_fleet_checklist_templates FOR ALL TO authenticated
USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin','superadmin') AND public.vihem_module_enabled('fleet_management'))
WITH CHECK (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin','superadmin') AND public.vihem_module_enabled('fleet_management'));

DROP POLICY IF EXISTS "Fleet checklist template items read" ON public.vihem_fleet_checklist_template_items;
CREATE POLICY "Fleet checklist template items read" ON public.vihem_fleet_checklist_template_items FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.vihem_fleet_checklist_templates tpl WHERE tpl.id = template_id AND tpl.organisation_id = public.vihem_get_my_org_id()) AND public.vihem_module_enabled('fleet_management'));
DROP POLICY IF EXISTS "Fleet checklist template items admin write" ON public.vihem_fleet_checklist_template_items;
CREATE POLICY "Fleet checklist template items admin write" ON public.vihem_fleet_checklist_template_items FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.vihem_fleet_checklist_templates tpl WHERE tpl.id = template_id AND tpl.organisation_id = public.vihem_get_my_org_id()) AND public.vihem_get_my_role() IN ('admin','superadmin') AND public.vihem_module_enabled('fleet_management'))
WITH CHECK (EXISTS (SELECT 1 FROM public.vihem_fleet_checklist_templates tpl WHERE tpl.id = template_id AND tpl.organisation_id = public.vihem_get_my_org_id()) AND public.vihem_get_my_role() IN ('admin','superadmin') AND public.vihem_module_enabled('fleet_management'));

DROP POLICY IF EXISTS "Fleet checklist run items read" ON public.vihem_fleet_checklist_run_items;
CREATE POLICY "Fleet checklist run items read" ON public.vihem_fleet_checklist_run_items FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.vihem_fleet_checklist_runs r WHERE r.id = run_id AND r.organisation_id = public.vihem_get_my_org_id()) AND public.vihem_module_enabled('fleet_management'));
DROP POLICY IF EXISTS "Fleet checklist run items staff write" ON public.vihem_fleet_checklist_run_items;
CREATE POLICY "Fleet checklist run items staff write" ON public.vihem_fleet_checklist_run_items FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.vihem_fleet_checklist_runs r WHERE r.id = run_id AND r.organisation_id = public.vihem_get_my_org_id()) AND public.vihem_get_my_role() IN ('staff','admin','superadmin') AND public.vihem_module_enabled('fleet_management'))
WITH CHECK (EXISTS (SELECT 1 FROM public.vihem_fleet_checklist_runs r WHERE r.id = run_id AND r.organisation_id = public.vihem_get_my_org_id()) AND public.vihem_get_my_role() IN ('staff','admin','superadmin') AND public.vihem_module_enabled('fleet_management'));

-- ---- Telematikenheter: personal läser status, admin hanterar ----
DROP POLICY IF EXISTS "Fleet telematics devices read" ON public.vihem_fleet_telematics_devices;
CREATE POLICY "Fleet telematics devices read" ON public.vihem_fleet_telematics_devices FOR SELECT TO authenticated
USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_module_enabled('fleet_management'));
DROP POLICY IF EXISTS "Fleet telematics devices admin write" ON public.vihem_fleet_telematics_devices;
CREATE POLICY "Fleet telematics devices admin write" ON public.vihem_fleet_telematics_devices FOR ALL TO authenticated
USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin','superadmin') AND public.vihem_module_enabled('fleet_management'))
WITH CHECK (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin','superadmin') AND public.vihem_module_enabled('fleet_management'));

DROP POLICY IF EXISTS "Fleet telematics assignments admin" ON public.vihem_fleet_telematics_device_assignments;
CREATE POLICY "Fleet telematics assignments admin" ON public.vihem_fleet_telematics_device_assignments FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.vihem_fleet_telematics_devices d WHERE d.id = device_id AND d.organisation_id = public.vihem_get_my_org_id()) AND public.vihem_get_my_role() IN ('admin','superadmin') AND public.vihem_module_enabled('fleet_management'))
WITH CHECK (EXISTS (SELECT 1 FROM public.vihem_fleet_telematics_devices d WHERE d.id = device_id AND d.organisation_id = public.vihem_get_my_org_id()) AND public.vihem_get_my_role() IN ('admin','superadmin') AND public.vihem_module_enabled('fleet_management'));

-- ---- Telematik-avläsningar (tidsserie): endast läsning för klienter,
-- via join mot devices. Inskrivning sker via mottagar-edge-funktionen
-- med service-role-nyckel (kringgår RLS), inte av inloggade användare. ----
DROP POLICY IF EXISTS "Fleet telematics readings read" ON public.vihem_fleet_telematics_readings;
CREATE POLICY "Fleet telematics readings read" ON public.vihem_fleet_telematics_readings FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.vihem_fleet_telematics_devices d WHERE d.id = device_id AND d.organisation_id = public.vihem_get_my_org_id()) AND public.vihem_module_enabled('fleet_management'));

DROP POLICY IF EXISTS "Fleet trips read" ON public.vihem_fleet_trips;
CREATE POLICY "Fleet trips read" ON public.vihem_fleet_trips FOR SELECT TO authenticated
USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_module_enabled('fleet_management'));

-- ---- Historik/audit: alla i org läser, alla i org (staff+) kan
-- logga en händelse, ALDRIG ändra/radera (omutabel logg) ----
DROP POLICY IF EXISTS "Fleet events read" ON public.vihem_fleet_events;
CREATE POLICY "Fleet events read" ON public.vihem_fleet_events FOR SELECT TO authenticated
USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_module_enabled('fleet_management'));
DROP POLICY IF EXISTS "Fleet events insert" ON public.vihem_fleet_events;
CREATE POLICY "Fleet events insert" ON public.vihem_fleet_events FOR INSERT TO authenticated
WITH CHECK (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('staff','admin','superadmin') AND public.vihem_module_enabled('fleet_management'));

-- ============================================================
-- Hjälpfunktioner
-- ============================================================

-- Rapportera mätarställning: loggar i historiken OCH uppdaterar
-- fordonets aktuella värde atomärt, samma mönster som
-- vihem_inventory_apply_transaction (en RPC gör båda skrivningarna).
CREATE OR REPLACE FUNCTION public.vihem_fleet_record_meter_reading(
  p_vehicle_id uuid,
  p_reading_type text,
  p_value numeric,
  p_source text DEFAULT 'manual',
  p_notes text DEFAULT '',
  p_recorded_at timestamptz DEFAULT now()
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.vihem_get_my_org_id();
  v_user uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_org IS NULL OR v_user IS NULL OR public.vihem_get_my_role() NOT IN ('staff','admin','superadmin') THEN
    RAISE EXCEPTION 'Ingen behörighet.';
  END IF;
  IF p_reading_type NOT IN ('odometer','engine_hours') THEN
    RAISE EXCEPTION 'Ogiltig typ av mätarställning.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vihem_fleet_vehicles WHERE id = p_vehicle_id AND organisation_id = v_org) THEN
    RAISE EXCEPTION 'Fordonet hittades inte.';
  END IF;

  INSERT INTO public.vihem_fleet_meter_readings (organisation_id, vehicle_id, reading_type, value, source, recorded_at, recorded_by, notes)
  VALUES (v_org, p_vehicle_id, p_reading_type, p_value, COALESCE(p_source, 'manual'), COALESCE(p_recorded_at, now()), v_user, COALESCE(p_notes, ''))
  RETURNING id INTO v_id;

  IF p_reading_type = 'odometer' THEN
    UPDATE public.vihem_fleet_vehicles SET current_odometer = p_value, updated_at = now() WHERE id = p_vehicle_id AND p_value >= current_odometer;
  ELSE
    UPDATE public.vihem_fleet_vehicles SET engine_hours = p_value, updated_at = now() WHERE id = p_vehicle_id AND p_value >= engine_hours;
  END IF;

  INSERT INTO public.vihem_fleet_events (organisation_id, vehicle_id, event_type, summary, metadata, actor_id)
  VALUES (v_org, p_vehicle_id, 'odometer_updated', format('%s registrerad: %s', CASE WHEN p_reading_type = 'odometer' THEN 'Mätarställning' ELSE 'Maskintimmar' END, p_value), jsonb_build_object('reading_type', p_reading_type, 'value', p_value, 'source', p_source), v_user);

  RETURN v_id;
END;
$$;

-- Konvertera en felrapport till en arbetsorder: skapar ordern och
-- länkar tillbaka, admin-only (arbetsordrar skapas normalt av admin/
-- ansvarig, matchar befintlig WorkOrdersPage-konvention).
CREATE OR REPLACE FUNCTION public.vihem_fleet_convert_damage_to_work_order(
  p_damage_report_id uuid,
  p_title text DEFAULT NULL,
  p_priority text DEFAULT 'normal'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.vihem_get_my_org_id();
  v_user uuid := auth.uid();
  v_report record;
  v_vehicle record;
  v_wo_id uuid;
  v_title text;
BEGIN
  IF v_org IS NULL OR v_user IS NULL OR public.vihem_get_my_role() NOT IN ('admin','superadmin') THEN
    RAISE EXCEPTION 'Endast admin kan skapa arbetsorder från en felrapport.';
  END IF;

  SELECT * INTO v_report FROM public.vihem_fleet_damage_reports WHERE id = p_damage_report_id AND organisation_id = v_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Felrapporten hittades inte.'; END IF;
  IF v_report.work_order_id IS NOT NULL THEN RAISE EXCEPTION 'Felrapporten har redan en arbetsorder.'; END IF;

  SELECT * INTO v_vehicle FROM public.vihem_fleet_vehicles WHERE id = v_report.vehicle_id;
  v_title := COALESCE(NULLIF(p_title, ''), format('%s -- %s', COALESCE(NULLIF(v_vehicle.registration_number, ''), v_vehicle.name), left(v_report.description, 80)));

  INSERT INTO public.vihem_work_orders (organisation_id, title, description, category, priority, status, vehicle_id, created_by)
  VALUES (v_org, v_title, v_report.description, 'Fordon', COALESCE(p_priority, 'normal'), 'new', v_report.vehicle_id, v_user)
  RETURNING id INTO v_wo_id;

  UPDATE public.vihem_fleet_damage_reports SET status = 'converted', work_order_id = v_wo_id, updated_at = now() WHERE id = p_damage_report_id;

  INSERT INTO public.vihem_fleet_events (organisation_id, vehicle_id, event_type, summary, metadata, actor_id)
  VALUES (v_org, v_report.vehicle_id, 'damage_converted', 'Felrapport omvandlad till arbetsorder', jsonb_build_object('damage_report_id', p_damage_report_id, 'work_order_id', v_wo_id), v_user);

  RETURN v_wo_id;
END;
$$;

-- Notis vid ny allvarlig skada (brådskande eller "får ej användas") --
-- ett INSERT-baserat event, spammar inte eftersom det bara skickas en
-- gång per rapport.
CREATE OR REPLACE FUNCTION public.notify_fleet_damage_reported()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vehicle record;
  v_reporter_name text;
  v_admin record;
BEGIN
  IF NEW.severity NOT IN ('urgent', 'no_use') THEN
    RETURN NEW;
  END IF;
  IF NOT public.notification_enabled(NEW.organisation_id, 'fleet_damage_reported') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_vehicle FROM public.vihem_fleet_vehicles WHERE id = NEW.vehicle_id;
  SELECT COALESCE(name, email, 'Personal') INTO v_reporter_name FROM public.vihem_profiles WHERE id = NEW.reported_by;

  FOR v_admin IN
    SELECT id FROM public.vihem_profiles WHERE organisation_id = NEW.organisation_id AND role IN ('admin', 'superadmin') AND active
  LOOP
    PERFORM public.create_notification(
      v_admin.id,
      NEW.organisation_id,
      CASE WHEN NEW.severity = 'no_use' THEN 'Fordon får ej användas' ELSE 'Brådskande fordonsskada' END,
      format('%s (%s) -- rapporterat av %s: %s', COALESCE(v_vehicle.name, ''), COALESCE(NULLIF(v_vehicle.registration_number, ''), v_vehicle.internal_number), v_reporter_name, left(NEW.description, 140)),
      'fleet',
      'fleet'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_fleet_damage_reported ON public.vihem_fleet_damage_reports;
CREATE TRIGGER trg_notify_fleet_damage_reported AFTER INSERT ON public.vihem_fleet_damage_reports
FOR EACH ROW EXECUTE FUNCTION public.notify_fleet_damage_reported();

-- updated_at-triggers, samma hjälpfunktion som redan används överallt
-- (vihem_touch_updated_at).
DO $$
DECLARE t text;
BEGIN
  IF to_regprocedure('public.vihem_touch_updated_at()') IS NULL THEN
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY[
    'vihem_fleet_vehicles','vihem_fleet_damage_reports','vihem_fleet_service_schedules',
    'vihem_fleet_inspections','vihem_fleet_tires','vihem_fleet_checklist_templates',
    'vihem_fleet_telematics_devices'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_updated_at ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER %I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at()', t, t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
