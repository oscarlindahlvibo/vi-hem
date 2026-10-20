BEGIN;
-- An IMEI registration is not proof of hardware ownership. Only the private operator can provision.
ALTER TABLE public.vihem_fleet_telematics_devices ADD COLUMN provisioned_at timestamptz;
GRANT SELECT(provisioned_at) ON public.vihem_fleet_telematics_devices TO authenticated;
CREATE FUNCTION public.vihem_fleet_provision_device(p_device uuid,p_org uuid,p_vehicle uuid,p_imei text,p_evidence text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d public.vihem_fleet_telematics_devices;BEGIN
 IF coalesce(length(trim(p_evidence)),0)<10 OR length(p_evidence)>1000 THEN RAISE EXCEPTION 'Document hardware/SIM ownership verification';END IF;
 SELECT * INTO d FROM public.vihem_fleet_telematics_devices WHERE id=p_device FOR UPDATE;
 IF d.id IS NULL OR d.organisation_id IS DISTINCT FROM p_org OR d.vehicle_id IS DISTINCT FROM p_vehicle OR d.imei IS DISTINCT FROM p_imei OR NOT d.active OR d.provider<>'teltonika' THEN RAISE EXCEPTION 'Provisioning target does not match verified device/org/vehicle';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.vihem_fleet_telematics_device_assignments a JOIN public.vihem_fleet_vehicles v ON v.id=a.vehicle_id WHERE a.device_id=d.id AND a.vehicle_id=p_vehicle AND a.unassigned_at IS NULL AND v.organisation_id=p_org) THEN RAISE EXCEPTION 'No matching assignment';END IF;
 IF d.provisioned_at IS NOT NULL THEN RETURN;END IF;
 UPDATE public.vihem_fleet_telematics_devices SET provisioned_at=clock_timestamp() WHERE id=d.id;
 INSERT INTO public.vihem_fleet_events(organisation_id,vehicle_id,event_type,summary,metadata) VALUES(p_org,p_vehicle,'updated','GPS-ägarskap verifierat av driftansvarig',jsonb_build_object('device_id',d.id,'verification',p_evidence));
END$$;
REVOKE ALL ON FUNCTION public.vihem_fleet_provision_device(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vihem_fleet_provision_device(uuid,uuid,uuid,text,text) TO service_role;
DO $$DECLARE f text;needle text:='IF NOT d.active OR d.expires_at<=now() OR NOT EXISTS';BEGIN
 SELECT pg_get_functiondef('public.vihem_fleet_ingest_position(jsonb)'::regprocedure) INTO f;
 IF position(needle in f)=0 THEN RAISE EXCEPTION 'Unexpected ingest definition; inspect before provisioning gate';END IF;
 f:=replace(f,needle,'IF d.provisioned_at IS NULL OR NOT d.active OR d.expires_at<=now() OR NOT EXISTS');EXECUTE f;
END$$;
NOTIFY pgrst,'reload schema';
COMMIT;
