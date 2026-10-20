BEGIN;
-- Independent of the device's resettable GPS counter and retained position history.
CREATE TABLE public.vihem_fleet_gps_odometer (
 vehicle_id uuid PRIMARY KEY REFERENCES public.vihem_fleet_vehicles(id),
 organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id),
 baseline_km numeric(14,3) NOT NULL CHECK(baseline_km BETWEEN 0 AND 10000000),
 baseline_at timestamptz NOT NULL,
 distance_km numeric(14,6) NOT NULL DEFAULT 0 CHECK(distance_km>=0),
 assignment_id uuid NOT NULL REFERENCES public.vihem_fleet_telematics_device_assignments(id),
 last_at timestamptz NOT NULL,last_lat double precision NOT NULL,last_lon double precision NOT NULL,last_speed numeric,
 gap_count integer NOT NULL DEFAULT 0,late_samples integer NOT NULL DEFAULT 0,rejected_segments integer NOT NULL DEFAULT 0,
 needs_calibration boolean NOT NULL DEFAULT false,
 calibration_revision integer NOT NULL DEFAULT 1,
 calibrated_by uuid NOT NULL REFERENCES public.vihem_profiles(id)
);
ALTER TABLE public.vihem_fleet_gps_odometer ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_admin_read ON public.vihem_fleet_gps_odometer FOR SELECT TO authenticated
 USING(organisation_id=public.vihem_get_my_org_id() AND public.vihem_fleet_tracking_admin());
REVOKE ALL ON public.vihem_fleet_gps_odometer FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.vihem_fleet_gps_odometer TO authenticated;
GRANT ALL ON public.vihem_fleet_gps_odometer TO service_role;

CREATE FUNCTION public.vihem_fleet_calibrate_gps_odometer(p_vehicle uuid,p_km numeric,p_revision integer DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v public.vihem_fleet_vehicles;r public.vihem_fleet_telematics_readings;s public.vihem_fleet_gps_odometer;
 calibrated timestamptz:=clock_timestamp();meter numeric;BEGIN
 IF NOT coalesce(public.vihem_fleet_tracking_admin(),false) THEN RAISE EXCEPTION 'Ingen behörighet' USING ERRCODE='42501';END IF;
 IF p_km IS NULL OR p_km::text IN('NaN','Infinity','-Infinity') OR p_km<0 OR p_km>10000000 THEN RAISE EXCEPTION 'Ange en giltig mätarställning i km';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('fleet-gps-meter:'||p_vehicle::text,0));
 calibrated:=clock_timestamp();
 SELECT * INTO v FROM public.vihem_fleet_vehicles WHERE id=p_vehicle AND organisation_id=public.vihem_get_my_org_id() FOR UPDATE;
 IF v.id IS NULL THEN RAISE EXCEPTION 'Ingen behörighet' USING ERRCODE='42501';END IF;
 SELECT * INTO s FROM public.vihem_fleet_gps_odometer WHERE vehicle_id=v.id;
 IF s.vehicle_id IS NOT NULL AND s.calibration_revision IS DISTINCT FROM p_revision OR s.vehicle_id IS NULL AND p_revision IS NOT NULL THEN
 RAISE EXCEPTION 'Avstämningen har ändrats. Läs om innan du sparar.' USING ERRCODE='40001';END IF;
 SELECT x.* INTO r FROM public.vihem_fleet_telematics_readings x
 JOIN public.vihem_fleet_telematics_devices d ON d.id=x.device_id AND d.vehicle_id=v.id AND d.active AND d.provisioned_at IS NOT NULL AND (d.expires_at IS NULL OR d.expires_at>now())
 JOIN public.vihem_fleet_telematics_device_assignments a ON a.id=x.assignment_id AND a.unassigned_at IS NULL
 WHERE x.vehicle_id=v.id AND x.organisation_id=v.organisation_id AND x.gps_valid ORDER BY x.recorded_at DESC,x.id DESC LIMIT 1;
 IF r.id IS NULL OR r.recorded_at<calibrated-interval '2 minutes' OR r.recorded_at>calibrated OR r.received_at<calibrated-interval '2 minutes' THEN
 RAISE EXCEPTION 'Invänta en aktuell GPS-position innan du stämmer av mätaren';END IF;
 IF r.speed_kmh IS NULL OR r.speed_kmh>3 THEN RAISE EXCEPTION 'Stäm av mätaren när fordonet står stilla';END IF;
 meter:=round(CASE WHEN v.odometer_unit='mil' THEN p_km/10 ELSE p_km END,1);
 IF meter<v.current_odometer THEN RAISE EXCEPTION 'Avläsningen är lägre än registrerad fordonsmätare. Kontrollera km och mil.';END IF;
 INSERT INTO public.vihem_fleet_gps_odometer(vehicle_id,organisation_id,baseline_km,baseline_at,assignment_id,last_at,last_lat,last_lon,last_speed,calibrated_by)
 VALUES(v.id,v.organisation_id,p_km,calibrated,r.assignment_id,r.recorded_at,r.latitude,r.longitude,r.speed_kmh,auth.uid())
 ON CONFLICT(vehicle_id) DO UPDATE SET baseline_km=excluded.baseline_km,baseline_at=excluded.baseline_at,distance_km=0,
 assignment_id=excluded.assignment_id,last_at=excluded.last_at,last_lat=excluded.last_lat,last_lon=excluded.last_lon,last_speed=excluded.last_speed,
 gap_count=0,late_samples=0,rejected_segments=0,needs_calibration=false,calibration_revision=vihem_fleet_gps_odometer.calibration_revision+1,calibrated_by=excluded.calibrated_by;
 INSERT INTO public.vihem_fleet_meter_readings(organisation_id,vehicle_id,reading_type,value,source,recorded_at,recorded_by,notes)
 VALUES(v.organisation_id,v.id,'odometer',meter,'manual',calibrated,auth.uid(),'Manuell avläsning; startpunkt för separat GPS-uppskattning');
 UPDATE public.vihem_fleet_vehicles SET current_odometer=meter,updated_at=calibrated WHERE id=v.id;
 INSERT INTO public.vihem_fleet_events(organisation_id,vehicle_id,event_type,summary,metadata,actor_id)
 VALUES(v.organisation_id,v.id,'updated','GPS-mätare avstämd mot manuellt avläst mätare',jsonb_build_object('baseline_km',p_km,'previous_estimate_km',s.baseline_km+s.distance_km,'previous_gap_count',s.gap_count),auth.uid());
END$$;
REVOKE ALL ON FUNCTION public.vihem_fleet_calibrate_gps_odometer(uuid,numeric,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vihem_fleet_calibrate_gps_odometer(uuid,numeric,integer) TO authenticated;

CREATE FUNCTION public.vihem_fleet_accumulate_gps_odometer() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.vihem_fleet_gps_odometer;gap double precision;delta double precision:=0;bad integer:=0;BEGIN
 IF NEW.vehicle_id IS NULL OR NOT NEW.gps_valid THEN RETURN NEW;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('fleet-gps-meter:'||NEW.vehicle_id::text,0));
 SELECT * INTO s FROM public.vihem_fleet_gps_odometer WHERE vehicle_id=NEW.vehicle_id AND organisation_id=NEW.organisation_id;
 IF s.vehicle_id IS NULL OR NEW.recorded_at<=s.baseline_at OR s.needs_calibration THEN RETURN NEW;END IF;
 IF NEW.assignment_id IS DISTINCT FROM s.assignment_id THEN
 UPDATE public.vihem_fleet_gps_odometer SET needs_calibration=true WHERE vehicle_id=s.vehicle_id;RETURN NEW;END IF;
 IF NEW.recorded_at<=s.last_at THEN
 UPDATE public.vihem_fleet_gps_odometer SET late_samples=late_samples+1 WHERE vehicle_id=s.vehicle_id;RETURN NEW;END IF;
 gap:=extract(epoch FROM NEW.recorded_at-s.last_at);
 IF gap<=300 AND greatest(coalesce(NEW.speed_kmh,0),coalesce(s.last_speed,0))>=3 THEN
 delta:=6371*2*asin(sqrt(least(1.0,power(sin(radians(NEW.latitude-s.last_lat)/2),2)+cos(radians(s.last_lat))*cos(radians(NEW.latitude))*power(sin(radians(NEW.longitude-s.last_lon)/2),2))));
 IF delta>gap/3600*200+0.1 THEN delta:=0;bad:=1;END IF;
 END IF;
 UPDATE public.vihem_fleet_gps_odometer SET distance_km=distance_km+delta,last_at=NEW.recorded_at,last_lat=NEW.latitude,last_lon=NEW.longitude,last_speed=NEW.speed_kmh,
 gap_count=gap_count+CASE WHEN gap>300 THEN 1 ELSE 0 END,rejected_segments=rejected_segments+bad WHERE vehicle_id=s.vehicle_id;
 RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION public.vihem_fleet_accumulate_gps_odometer() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER fleet_gps_odometer_after_position AFTER INSERT ON public.vihem_fleet_telematics_readings FOR EACH ROW EXECUTE FUNCTION public.vihem_fleet_accumulate_gps_odometer();
NOTIFY pgrst,'reload schema';
COMMIT;
