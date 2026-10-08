-- Fleet: kontrollera sparade källor varje timme (högst 10 per körning, bara de som är på tur) i stället för en gång per dygn.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vihem-fleet-source-recheck-daily') THEN
    PERFORM cron.unschedule('vihem-fleet-source-recheck-daily');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vihem-fleet-source-recheck') THEN
    PERFORM cron.unschedule('vihem-fleet-source-recheck');
  END IF;
  PERFORM cron.schedule('vihem-fleet-source-recheck', '40 * * * *', $job$ SELECT public.vihem_trigger_fleet_source_recheck(); $job$);
END $$;
