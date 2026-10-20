BEGIN;
-- Retain the distance sum, not an expired precise location anchor.
ALTER TABLE public.vihem_fleet_gps_odometer ALTER COLUMN last_lat DROP NOT NULL,ALTER COLUMN last_lon DROP NOT NULL;
DO $$DECLARE f text;needle text:=' RETURN removed;';BEGIN
 SELECT pg_get_functiondef('public.vihem_fleet_tracking_maintenance()'::regprocedure) INTO f;
 IF position(needle in f)=0 THEN RAISE EXCEPTION 'Unexpected GPS maintenance definition; review before installing';END IF;
 f:=replace(f,needle,$patch$
 UPDATE public.vihem_fleet_gps_odometer m SET last_lat=NULL,last_lon=NULL,needs_calibration=true
 WHERE m.last_lat IS NOT NULL AND m.last_at<now()-make_interval(days=>coalesce((SELECT position_retention_days FROM public.vihem_fleet_tracking_settings WHERE organisation_id=m.organisation_id),90));
 RETURN removed;$patch$);
 EXECUTE f;
END$$;
COMMIT;
