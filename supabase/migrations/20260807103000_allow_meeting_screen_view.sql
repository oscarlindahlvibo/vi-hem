DO $$
DECLARE
  constraint_record record;
BEGIN
  IF to_regclass('public.vihem_screen_settings') IS NOT NULL THEN
    FOR constraint_record IN
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'public.vihem_screen_settings'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%screen_view%'
    LOOP
      EXECUTE format('ALTER TABLE public.vihem_screen_settings DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
    END LOOP;

    ALTER TABLE public.vihem_screen_settings
      ADD CONSTRAINT vihem_screen_settings_screen_view_check
      CHECK (screen_view IN ('short-stay', 'work-orders', 'presentation', 'laundry', 'meeting'));
  END IF;
END $$;
