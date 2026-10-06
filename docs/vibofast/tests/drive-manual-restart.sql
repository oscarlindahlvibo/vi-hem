DO $$
DECLARE property uuid;job jsonb;
BEGIN
 SELECT id INTO property FROM public.vihem_properties WHERE organisation_id=(SELECT organisation_id FROM vihem_vibofast_private.site_content) ORDER BY id LIMIT 1;
 UPDATE vihem_vibofast_private.drive_runs SET next_offset=6 WHERE property_id=property;
 job:=public.vihem_vibofast_drive_worker('claim',jsonb_build_object('property_id',property,'restart',true));
 IF job->>'status'='busy' THEN RAISE EXCEPTION 'Background sync is busy; retry test after it finishes'; END IF;
 IF (job->>'offset')::integer<>0 THEN RAISE EXCEPTION 'Manual sync did not reset offset'; END IF;
 PERFORM public.vihem_vibofast_drive_worker('finish',jsonb_build_object('lease',job->>'lease','next_offset',6));
 job:=public.vihem_vibofast_drive_worker('claim',jsonb_build_object('property_id',property));
 IF (job->>'offset')::integer<>6 THEN RAISE EXCEPTION 'Scheduled sync lost its progress'; END IF;
 PERFORM public.vihem_vibofast_drive_worker('finish',jsonb_build_object('lease',job->>'lease'));
 RAISE NOTICE 'PASS: manual sync resets to the first apartment, scheduled sync retains progress. Rollback follows.';
END $$;
