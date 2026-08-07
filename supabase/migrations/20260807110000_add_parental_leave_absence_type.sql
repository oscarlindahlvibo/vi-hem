ALTER TABLE public.vihem_staff_absence_requests
  DROP CONSTRAINT IF EXISTS staff_absence_requests_absence_type_check;

ALTER TABLE public.vihem_staff_absence_requests
  DROP CONSTRAINT IF EXISTS vihem_staff_absence_requests_absence_type_check;

ALTER TABLE public.vihem_staff_absence_requests
  ADD CONSTRAINT vihem_staff_absence_requests_absence_type_check
  CHECK (absence_type IN ('sick', 'vab', 'vacation', 'leave', 'unpaid_leave', 'parental_leave'));

CREATE OR REPLACE FUNCTION public.notify_staff_absence_submitted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  admin_record record;
  staff_name text;
  absence_label text;
BEGIN
  IF NEW.organisation_id IS NULL OR NEW.status <> 'submitted' THEN
    RETURN NEW;
  END IF;

  IF NOT public.notification_enabled(NEW.organisation_id, 'staff_absence_submitted') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(name, email, 'Personal') INTO staff_name
  FROM public.vihem_profiles
  WHERE id = NEW.user_id;

  absence_label := CASE NEW.absence_type
    WHEN 'sick' THEN 'sjukanmält sig'
    WHEN 'vab' THEN 'anmält VAB'
    WHEN 'vacation' THEN 'ansökt om semester'
    WHEN 'leave' THEN 'ansökt om ledighet'
    WHEN 'unpaid_leave' THEN 'ansökt om tjänstledighet'
    WHEN 'parental_leave' THEN 'anmält föräldraledighet'
    ELSE 'skickat in frånvaro'
  END;

  FOR admin_record IN
    SELECT id FROM public.vihem_profiles
    WHERE organisation_id = NEW.organisation_id
      AND role = 'admin'
      AND active = true
      AND id <> NEW.user_id
  LOOP
    PERFORM public.create_notification(
      admin_record.id,
      NEW.organisation_id,
      'Ny frånvaroanmälan',
      staff_name || ' har ' || absence_label || '.',
      'absence',
      'timetracking'
    );
  END LOOP;

  RETURN NEW;
END;
$$;
