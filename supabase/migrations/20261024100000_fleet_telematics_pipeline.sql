BEGIN;
-- Fail rather than silently choosing an organisation for a duplicated IMEI.
DO $$BEGIN IF EXISTS(SELECT imei FROM public.vihem_fleet_telematics_devices WHERE imei<>'' GROUP BY imei HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate IMEI across organisations; resolve before installing telematics';END IF;END$$;
DO $$BEGIN IF EXISTS(SELECT 1 FROM public.vihem_fleet_telematics_device_assignments a JOIN public.vihem_fleet_telematics_device_assignments b ON a.device_id=b.device_id AND a.id<b.id AND tstzrange(a.assigned_at,a.unassigned_at,'[)') && tstzrange(b.assigned_at,b.unassigned_at,'[)')) THEN RAISE EXCEPTION 'Overlapping device assignments; review before migration';END IF;END$$;
CREATE UNIQUE INDEX fleet_one_open_assignment ON public.vihem_fleet_telematics_device_assignments(device_id) WHERE unassigned_at IS NULL;
CREATE UNIQUE INDEX fleet_imei_global ON public.vihem_fleet_telematics_devices(imei) WHERE imei<>'';
ALTER TABLE public.vihem_fleet_telematics_devices ADD COLUMN last_position_at timestamptz,ADD COLUMN expires_at timestamptz;
ALTER TABLE public.vihem_fleet_telematics_readings
 ADD COLUMN organisation_id uuid REFERENCES public.vihem_organisations(id),
 ADD COLUMN vehicle_id uuid REFERENCES public.vihem_fleet_vehicles(id),
 ADD COLUMN assignment_id uuid REFERENCES public.vihem_fleet_telematics_device_assignments(id),
 ADD COLUMN provider_message_id text,
 ADD COLUMN sample_fingerprint text,
 ADD COLUMN received_at timestamptz,
 ADD COLUMN backup_battery_voltage numeric(5,2),
 ADD COLUMN gps_valid boolean NOT NULL DEFAULT false,
 ADD COLUMN odometer_source text;
-- Only attribute legacy readings where an actual historical assignment interval exists.
UPDATE public.vihem_fleet_telematics_readings r SET organisation_id=d.organisation_id,vehicle_id=a.vehicle_id,assignment_id=a.id
FROM public.vihem_fleet_telematics_devices d JOIN public.vihem_fleet_telematics_device_assignments a ON a.device_id=d.id
JOIN public.vihem_fleet_vehicles v ON v.id=a.vehicle_id AND v.organisation_id=d.organisation_id
WHERE r.device_id=d.id AND r.recorded_at>=a.assigned_at AND (a.unassigned_at IS NULL OR r.recorded_at<a.unassigned_at);
CREATE UNIQUE INDEX fleet_position_dedupe ON public.vihem_fleet_telematics_readings(device_id,provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE UNIQUE INDEX fleet_sample_dedupe ON public.vihem_fleet_telematics_readings(device_id,sample_fingerprint) WHERE sample_fingerprint IS NOT NULL;
CREATE INDEX fleet_positions_vehicle_time ON public.vihem_fleet_telematics_readings(organisation_id,vehicle_id,recorded_at DESC);
ALTER TABLE public.vihem_fleet_trips ADD COLUMN driver_id uuid REFERENCES public.vihem_profiles(id),ADD COLUMN notes text NOT NULL DEFAULT '',ADD COLUMN destination text NOT NULL DEFAULT '',ADD COLUMN description text NOT NULL DEFAULT '',ADD COLUMN distance_source text NOT NULL DEFAULT 'gps_estimated',ADD COLUMN needs_review boolean NOT NULL DEFAULT false,ADD COLUMN idle_seconds integer NOT NULL DEFAULT 0,ADD COLUMN revision integer NOT NULL DEFAULT 1;
CREATE FUNCTION public.vihem_fleet_tracking_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=auth.uid() AND active AND role IN ('admin','superadmin')) AND public.vihem_module_enabled('fleet_management')
$$;
REVOKE ALL ON FUNCTION public.vihem_fleet_tracking_admin() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vihem_fleet_tracking_admin() TO authenticated,service_role;
CREATE TABLE public.vihem_fleet_tracking_settings(organisation_id uuid PRIMARY KEY REFERENCES public.vihem_organisations(id),position_retention_days integer NOT NULL DEFAULT 90 CHECK(position_retention_days BETWEEN 7 AND 3650),trip_retention_days integer NOT NULL DEFAULT 730 CHECK(trip_retention_days BETWEEN 7 AND 3650));
ALTER TABLE public.vihem_fleet_tracking_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_settings ON public.vihem_fleet_tracking_settings FOR ALL TO authenticated USING(organisation_id=public.vihem_get_my_org_id() AND public.vihem_fleet_tracking_admin()) WITH CHECK(organisation_id=public.vihem_get_my_org_id() AND public.vihem_fleet_tracking_admin());
GRANT SELECT,INSERT,UPDATE ON public.vihem_fleet_tracking_settings TO authenticated;
GRANT ALL ON public.vihem_fleet_tracking_settings TO service_role;
CREATE TABLE public.vihem_fleet_tracking_state(device_id uuid PRIMARY KEY REFERENCES public.vihem_fleet_telematics_devices(id),assignment_id uuid,trip_id uuid REFERENCES public.vihem_fleet_trips(id) ON DELETE SET NULL,last_at timestamptz,last_lat double precision,last_lon double precision,last_moving_at timestamptz,stopped_since timestamptz);
ALTER TABLE public.vihem_fleet_tracking_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vihem_fleet_tracking_state FROM anon,authenticated;
GRANT ALL ON public.vihem_fleet_tracking_state TO service_role;
-- Current-device ownership must never change access to historical position rows.
CREATE POLICY fleet_position_snapshot_guard ON public.vihem_fleet_telematics_readings AS RESTRICTIVE FOR SELECT TO authenticated USING(organisation_id=public.vihem_get_my_org_id() AND public.vihem_fleet_tracking_admin());
CREATE POLICY fleet_private_journal_guard ON public.vihem_fleet_trips AS RESTRICTIVE FOR SELECT TO authenticated USING(organisation_id=public.vihem_get_my_org_id() AND public.vihem_fleet_tracking_admin());
REVOKE ALL ON public.vihem_fleet_telematics_readings,public.vihem_fleet_trips FROM anon,authenticated;
GRANT SELECT ON public.vihem_fleet_telematics_readings,public.vihem_fleet_trips TO authenticated;
GRANT ALL ON public.vihem_fleet_telematics_readings,public.vihem_fleet_trips TO service_role;
-- The old per-device API key is unused by the new integration and must not be readable by clients.
REVOKE ALL ON public.vihem_fleet_telematics_devices,public.vihem_fleet_telematics_device_assignments FROM anon,authenticated;
GRANT SELECT(id,organisation_id,vehicle_id,provider,device_model,imei,sim_number,status,last_contact_at,last_position_at,expires_at,active,created_by,created_at,updated_at) ON public.vihem_fleet_telematics_devices TO authenticated;
GRANT SELECT ON public.vihem_fleet_telematics_device_assignments TO authenticated;
CREATE FUNCTION public.vihem_fleet_device_org_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$BEGIN
 IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id OR NEW.imei IS DISTINCT FROM OLD.imei THEN RAISE EXCEPTION 'Device identity and organisation are immutable; register a separately reviewed transfer';END IF;RETURN NEW;
END$$;
CREATE TRIGGER fleet_device_identity BEFORE UPDATE ON public.vihem_fleet_telematics_devices FOR EACH ROW EXECUTE FUNCTION public.vihem_fleet_device_org_guard();
CREATE FUNCTION public.vihem_fleet_pair_device(p_vehicle uuid,p_imei text,p_model text,p_sim text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE org uuid:=public.vihem_get_my_org_id();d public.vihem_fleet_telematics_devices;BEGIN
 IF NOT public.vihem_fleet_tracking_admin() OR NOT EXISTS(SELECT 1 FROM public.vihem_fleet_vehicles WHERE id=p_vehicle AND organisation_id=org) THEN RAISE EXCEPTION 'Ingen behörighet' USING ERRCODE='42501';END IF;
 p_model:=upper(trim(p_model));
 IF p_model IS NULL OR p_model='' THEN RAISE EXCEPTION 'Ange enhetsmodell';END IF;
 IF p_imei !~ '^[0-9]{15}$' OR length(p_model)>100 OR length(p_sim)>100 THEN RAISE EXCEPTION 'Ange ett giltigt 15-siffrigt IMEI';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('fleet-imei:'||p_imei,0));
 PERFORM 1 FROM public.vihem_fleet_vehicles WHERE id=p_vehicle FOR UPDATE;
 SELECT * INTO d FROM public.vihem_fleet_telematics_devices WHERE imei=p_imei FOR UPDATE;
 IF d.id IS NOT NULL AND (d.organisation_id<>org OR NOT d.active OR d.expires_at<=now() OR (d.vehicle_id IS NOT NULL AND d.vehicle_id<>p_vehicle)) THEN RAISE EXCEPTION 'Enheten är inte tillgänglig för koppling';END IF;
 IF EXISTS(SELECT 1 FROM public.vihem_fleet_telematics_devices WHERE vehicle_id=p_vehicle AND active AND id IS DISTINCT FROM d.id) THEN RAISE EXCEPTION 'Koppla bort befintlig enhet först';END IF;
 IF d.id IS NULL THEN
 INSERT INTO public.vihem_fleet_telematics_devices(organisation_id,vehicle_id,imei,device_model,sim_number,created_by) VALUES(org,p_vehicle,p_imei,p_model,p_sim,auth.uid()) RETURNING * INTO d;
 ELSE UPDATE public.vihem_fleet_telematics_devices SET vehicle_id=p_vehicle,device_model=p_model,sim_number=p_sim WHERE id=d.id;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.vihem_fleet_telematics_device_assignments WHERE device_id=d.id AND vehicle_id=p_vehicle AND unassigned_at IS NULL) THEN
 INSERT INTO public.vihem_fleet_telematics_device_assignments(device_id,vehicle_id,created_by) VALUES(d.id,p_vehicle,auth.uid());
 INSERT INTO public.vihem_fleet_events(organisation_id,vehicle_id,event_type,summary,actor_id) VALUES(org,p_vehicle,'device_assigned','GPS-enhet kopplad',auth.uid());END IF;
 RETURN d.id;
END$$;
CREATE FUNCTION public.vihem_fleet_unpair_device(p_device uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d public.vihem_fleet_telematics_devices;BEGIN
 IF NOT public.vihem_fleet_tracking_admin() THEN RAISE EXCEPTION 'Ingen behörighet' USING ERRCODE='42501';END IF;
 SELECT * INTO d FROM public.vihem_fleet_telematics_devices WHERE id=p_device AND organisation_id=public.vihem_get_my_org_id() FOR UPDATE;
 IF d.id IS NULL THEN RAISE EXCEPTION 'Enheten hittades inte';END IF;
 IF d.vehicle_id IS NULL THEN RETURN;END IF;
 UPDATE public.vihem_fleet_telematics_device_assignments SET unassigned_at=clock_timestamp() WHERE device_id=d.id AND unassigned_at IS NULL;
 UPDATE public.vihem_fleet_trips SET ended_at=coalesce(ended_at,(SELECT last_at FROM public.vihem_fleet_tracking_state WHERE device_id=d.id),clock_timestamp()),needs_review=true WHERE device_id=d.id AND ended_at IS NULL;
 DELETE FROM public.vihem_fleet_tracking_state WHERE device_id=d.id;
 UPDATE public.vihem_fleet_telematics_devices SET vehicle_id=NULL,status='unknown',last_position_at=NULL WHERE id=d.id;
 INSERT INTO public.vihem_fleet_events(organisation_id,vehicle_id,event_type,summary,actor_id) VALUES(d.organisation_id,d.vehicle_id,'device_unassigned','GPS-enhet bortkopplad; historik bevarad',auth.uid());
END$$;
ALTER TABLE public.vihem_fleet_trips ADD COLUMN start_odometer_km numeric(12,3),ADD COLUMN end_odometer_km numeric(12,3),ADD COLUMN odometer_manual boolean NOT NULL DEFAULT false;
CREATE FUNCTION public.vihem_fleet_ingest_position(p jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d public.vihem_fleet_telematics_devices;a public.vihem_fleet_telematics_device_assignments;v public.vihem_fleet_vehicles;s public.vihem_fleet_tracking_state;
 at_time timestamptz:=(p->>'recorded_at')::timestamptz;received timestamptz:=(p->>'received_at')::timestamptz;rid bigint;lat double precision:=(p->>'latitude')::double precision;lon double precision:=(p->>'longitude')::double precision;speed numeric:=(p->>'speed_kmh')::numeric;odo numeric:=(p->>'odometer')::numeric;moving boolean;delta double precision:=0;gap double precision;valid boolean:=(p->>'gps_valid')::boolean;odo_value numeric;
BEGIN
 IF at_time IS NULL OR received IS NULL OR at_time>now()+interval '5 minutes' OR received>now()+interval '5 minutes' OR nullif(p->>'message_id','') IS NULL THEN RAISE EXCEPTION 'Invalid position metadata';END IF;
 SELECT * INTO d FROM public.vihem_fleet_telematics_devices WHERE imei=p->>'imei' FOR UPDATE;
 IF d.id IS NULL THEN RAISE EXCEPTION 'Unknown device' USING ERRCODE='22023';END IF;
 IF NOT d.active OR d.expires_at<=now() OR NOT EXISTS(SELECT 1 FROM public.vihem_organisation_modules WHERE organisation_id=d.organisation_id AND module_key='fleet_management' AND enabled) THEN RAISE EXCEPTION 'Inactive device or module' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM public.vihem_fleet_telematics_readings WHERE device_id=d.id AND provider_message_id=p->>'message_id') THEN RETURN 'duplicate';END IF;
 SELECT * INTO a FROM public.vihem_fleet_telematics_device_assignments WHERE device_id=d.id AND at_time>=assigned_at AND (unassigned_at IS NULL OR at_time<unassigned_at) ORDER BY assigned_at DESC LIMIT 1;
 SELECT * INTO v FROM public.vihem_fleet_vehicles WHERE id=a.vehicle_id AND organisation_id=d.organisation_id;
 IF v.id IS NULL THEN RAISE EXCEPTION 'No historical assignment for position' USING ERRCODE='22023';END IF;
 IF valid AND (lat IS NULL OR lon IS NULL OR lat NOT BETWEEN -90 AND 90 OR lon NOT BETWEEN -180 AND 180 OR (lat=0 AND lon=0)) THEN RAISE EXCEPTION 'Invalid coordinates';END IF;
 INSERT INTO public.vihem_fleet_telematics_readings(device_id,organisation_id,vehicle_id,assignment_id,provider_message_id,sample_fingerprint,recorded_at,received_at,gps_valid,latitude,longitude,speed_kmh,heading,ignition,odometer,odometer_source,engine_rpm,fuel_level_pct,battery_voltage,backup_battery_voltage,engine_hours,signal_quality,source)
 VALUES(d.id,d.organisation_id,v.id,a.id,p->>'message_id',md5((p-'message_id'-'received_at'-'engine_hours')::text),at_time,received,valid,CASE WHEN valid THEN lat END,CASE WHEN valid THEN lon END,speed,(p->>'heading')::numeric,(p->>'ignition')::boolean,odo,p->>'odometer_source',(p->>'engine_rpm')::integer,(p->>'fuel_level_pct')::numeric,(p->>'battery_voltage')::numeric,(p->>'backup_battery_voltage')::numeric,(p->>'engine_hours')::numeric,(p->>'signal_quality')::integer,'traccar') ON CONFLICT DO NOTHING RETURNING id INTO rid;
 IF rid IS NULL THEN RETURN 'duplicate';END IF;
 UPDATE public.vihem_fleet_telematics_devices SET last_contact_at=greatest(last_contact_at,received),status=CASE WHEN received>now()-interval '5 minutes' THEN 'online' ELSE status END WHERE id=d.id;
 -- Late positions retain their original vehicle; never rewind current state or mutate that vehicle's successor.
 IF d.vehicle_id IS DISTINCT FROM v.id OR a.unassigned_at IS NOT NULL OR (d.last_position_at IS NOT NULL AND at_time<=d.last_position_at) THEN UPDATE public.vihem_fleet_trips SET needs_review=true WHERE device_id=d.id AND vehicle_id=v.id AND (at_time BETWEEN started_at AND coalesce(ended_at,now()) OR started_at BETWEEN at_time AND at_time+interval '15 minutes');RETURN 'historical';END IF;
 UPDATE public.vihem_fleet_telematics_devices SET last_position_at=at_time WHERE id=d.id;
 -- Only measured OBD odometer, never the GPS-derived total. Store in the vehicle's configured unit.
 IF odo IS NOT NULL AND p->>'odometer_source'='obd_measured' THEN
 odo_value:=CASE WHEN v.odometer_unit='mil' THEN odo/10 ELSE odo END;
 IF odo_value>v.current_odometer AND (v.current_odometer=0 OR odo_value-v.current_odometer<=greatest(500,extract(epoch FROM at_time-coalesce(d.last_position_at,at_time))/3600*250)) THEN
 INSERT INTO public.vihem_fleet_meter_readings(organisation_id,vehicle_id,reading_type,value,source,recorded_at,notes) VALUES(d.organisation_id,v.id,'odometer',odo_value,'telematics',at_time,'OBD uppmätt via Traccar');
 UPDATE public.vihem_fleet_vehicles SET current_odometer=odo_value,updated_at=now() WHERE id=v.id;END IF;END IF;
 IF NOT valid THEN RETURN 'no_fix';END IF;
 INSERT INTO public.vihem_fleet_tracking_state(device_id,assignment_id) VALUES(d.id,a.id) ON CONFLICT DO NOTHING;
 SELECT * INTO s FROM public.vihem_fleet_tracking_state WHERE device_id=d.id FOR UPDATE;
 gap:=extract(epoch FROM at_time-s.last_at);
 IF s.trip_id IS NOT NULL AND (gap>900 OR s.assignment_id IS DISTINCT FROM a.id) THEN UPDATE public.vihem_fleet_trips SET ended_at=s.last_at,needs_review=true WHERE id=s.trip_id;s.trip_id:=NULL;END IF;
 moving:=coalesce(speed>=5,false) AND coalesce((p->>'ignition')::boolean,true);
 IF s.last_lat IS NOT NULL AND gap>0 AND gap<=300 THEN
 delta:=6371*2*asin(sqrt(least(1.0,power(sin(radians(lat-s.last_lat)/2),2)+cos(radians(s.last_lat))*cos(radians(lat))*power(sin(radians(lon-s.last_lon)/2),2))));
 IF delta>gap/3600*200+0.1 THEN delta:=0;IF s.trip_id IS NOT NULL THEN UPDATE public.vihem_fleet_trips SET needs_review=true WHERE id=s.trip_id;END IF;END IF;END IF;
 IF moving AND s.trip_id IS NULL THEN
 INSERT INTO public.vihem_fleet_trips(organisation_id,vehicle_id,device_id,started_at,start_latitude,start_longitude,end_latitude,end_longitude,distance_km,purpose,start_odometer_km,end_odometer_km) VALUES(d.organisation_id,v.id,d.id,at_time,lat,lon,lat,lon,0,'unknown',CASE WHEN p->>'odometer_source'='obd_measured' THEN odo END,CASE WHEN p->>'odometer_source'='obd_measured' THEN odo END) RETURNING id INTO s.trip_id;
 ELSIF s.trip_id IS NOT NULL THEN
 UPDATE public.vihem_fleet_trips SET distance_km=coalesce(distance_km,0)+delta,end_odometer_km=CASE WHEN p->>'odometer_source'='obd_measured' AND NOT odometer_manual THEN odo ELSE end_odometer_km END,end_latitude=lat,end_longitude=lon,idle_seconds=idle_seconds+CASE WHEN NOT moving AND gap BETWEEN 0 AND 300 THEN gap::integer ELSE 0 END,needs_review=needs_review OR gap>300 WHERE id=s.trip_id;
 END IF;
 IF moving THEN s.last_moving_at:=at_time;s.stopped_since:=NULL;
 ELSIF s.trip_id IS NOT NULL THEN
 s.stopped_since:=coalesce(s.stopped_since,at_time);
 IF at_time-s.stopped_since>=interval '3 minutes' THEN UPDATE public.vihem_fleet_trips SET ended_at=at_time WHERE id=s.trip_id;s.trip_id:=NULL;END IF;END IF;
 UPDATE public.vihem_fleet_tracking_state SET assignment_id=a.id,trip_id=s.trip_id,last_at=at_time,last_lat=lat,last_lon=lon,last_moving_at=s.last_moving_at,stopped_since=s.stopped_since WHERE device_id=d.id;
 RETURN 'stored';
END$$;
-- Preserve precision between short samples; UI rounds only for presentation.
ALTER TABLE public.vihem_fleet_trips ALTER COLUMN distance_km TYPE numeric(12,4);

CREATE FUNCTION public.vihem_fleet_edit_trip(p_id uuid,p_revision integer,p_purpose text,p_driver uuid,p_description text,p_notes text,p_start_address text,p_end_address text,p_start_meter numeric DEFAULT NULL,p_end_meter numeric DEFAULT NULL,p_meter_manual boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT public.vihem_fleet_tracking_admin() THEN RAISE EXCEPTION 'Ingen behörighet' USING ERRCODE='42501';END IF;
 IF p_purpose NOT IN ('unknown','private','business') OR length(p_description)>1000 OR length(p_notes)>4000 OR length(p_start_address)>500 OR length(p_end_address)>500 THEN RAISE EXCEPTION 'Ogiltig journaluppgift';END IF;
 IF p_driver IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=p_driver AND organisation_id=public.vihem_get_my_org_id() AND active AND role IN ('staff','admin','superadmin')) THEN RAISE EXCEPTION 'Föraren tillhör inte organisationen';END IF;
 IF p_purpose='business' AND (nullif(trim(p_description),'') IS NULL OR p_driver IS NULL) THEN RAISE EXCEPTION 'Tjänsteresa kräver förare och syfte';END IF;
 IF p_meter_manual AND ((p_start_meter IS NOT NULL AND (p_start_meter<0 OR p_start_meter>10000000)) OR (p_end_meter IS NOT NULL AND (p_end_meter<0 OR p_end_meter>10000000)) OR (p_start_meter IS NOT NULL AND p_end_meter<p_start_meter)) THEN RAISE EXCEPTION 'Ogiltiga mätarställningar';END IF;
 UPDATE public.vihem_fleet_trips SET start_odometer_km=CASE WHEN p_meter_manual THEN p_start_meter ELSE start_odometer_km END,end_odometer_km=CASE WHEN p_meter_manual THEN p_end_meter ELSE end_odometer_km END,odometer_manual=odometer_manual OR p_meter_manual,purpose=p_purpose,driver_id=p_driver,description=p_description,notes=p_notes,start_address=p_start_address,end_address=p_end_address,revision=revision+1
 WHERE id=p_id AND organisation_id=public.vihem_get_my_org_id() AND revision=p_revision;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resan har ändrats. Läs om innan du sparar.' USING ERRCODE='40001';END IF;
END$$;
CREATE FUNCTION public.vihem_fleet_tracking_maintenance() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE removed integer;BEGIN
 UPDATE public.vihem_fleet_telematics_devices SET status='offline' WHERE last_contact_at<now()-interval '5 minutes' AND status='online';
 UPDATE public.vihem_fleet_trips t SET ended_at=s.last_at,needs_review=true FROM public.vihem_fleet_tracking_state s WHERE t.id=s.trip_id AND t.ended_at IS NULL AND s.last_at<now()-interval '15 minutes';
 UPDATE public.vihem_fleet_tracking_state s SET trip_id=NULL WHERE EXISTS(SELECT 1 FROM public.vihem_fleet_trips t WHERE t.id=s.trip_id AND t.ended_at IS NOT NULL);
 DELETE FROM public.vihem_fleet_telematics_readings WHERE id IN (SELECT r.id FROM public.vihem_fleet_telematics_readings r LEFT JOIN public.vihem_fleet_tracking_settings s USING(organisation_id) WHERE r.recorded_at<now()-make_interval(days=>coalesce(s.position_retention_days,90)) LIMIT 10000);
 GET DIAGNOSTICS removed=ROW_COUNT;
 DELETE FROM public.vihem_fleet_tracking_state st USING public.vihem_fleet_telematics_devices d WHERE st.device_id=d.id AND st.trip_id IS NULL AND st.last_at<now()-make_interval(days=>coalesce((SELECT position_retention_days FROM public.vihem_fleet_tracking_settings WHERE organisation_id=d.organisation_id),90));
 DELETE FROM public.vihem_fleet_trips WHERE id IN (SELECT t.id FROM public.vihem_fleet_trips t LEFT JOIN public.vihem_fleet_tracking_settings s USING(organisation_id) WHERE t.ended_at<now()-make_interval(days=>coalesce(s.trip_retention_days,730)) LIMIT 1000);
 RETURN removed;
END$$;
CREATE FUNCTION public.vihem_fleet_latest_positions() RETURNS SETOF public.vihem_fleet_telematics_readings LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT DISTINCT ON (vehicle_id) r.* FROM public.vihem_fleet_telematics_readings r WHERE vehicle_id IS NOT NULL AND gps_valid ORDER BY vehicle_id,recorded_at DESC,id DESC
$$;
REVOKE ALL ON FUNCTION public.vihem_fleet_pair_device(uuid,text,text,text),public.vihem_fleet_unpair_device(uuid),public.vihem_fleet_edit_trip(uuid,integer,text,uuid,text,text,text,text,numeric,numeric,boolean),public.vihem_fleet_latest_positions() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vihem_fleet_pair_device(uuid,text,text,text),public.vihem_fleet_unpair_device(uuid),public.vihem_fleet_edit_trip(uuid,integer,text,uuid,text,text,text,text,numeric,numeric,boolean),public.vihem_fleet_latest_positions() TO authenticated;
REVOKE ALL ON FUNCTION public.vihem_fleet_ingest_position(jsonb),public.vihem_fleet_tracking_maintenance() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vihem_fleet_ingest_position(jsonb),public.vihem_fleet_tracking_maintenance() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
