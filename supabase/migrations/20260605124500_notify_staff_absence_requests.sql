UPDATE organisation_notification_settings
SET settings = settings || jsonb_build_object('staff_absence_submitted', true)
WHERE NOT (settings ? 'staff_absence_submitted');

CREATE OR REPLACE FUNCTION notify_staff_absence_submitted()
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

  IF NOT notification_enabled(NEW.organisation_id, 'staff_absence_submitted') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(name, email, 'Personal') INTO staff_name
  FROM profiles
  WHERE id = NEW.user_id;

  absence_label := CASE NEW.absence_type
    WHEN 'sick' THEN 'sjukanmält sig'
    WHEN 'vab' THEN 'anmält VAB'
    WHEN 'vacation' THEN 'ansökt om semester'
    WHEN 'leave' THEN 'ansökt om ledighet'
    WHEN 'unpaid_leave' THEN 'ansökt om tjänstledighet'
    ELSE 'skickat in frånvaro'
  END;

  FOR admin_record IN
    SELECT id FROM profiles
    WHERE organisation_id = NEW.organisation_id
      AND role = 'admin'
      AND active = true
      AND id <> NEW.user_id
  LOOP
    PERFORM create_notification(
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

DROP TRIGGER IF EXISTS trg_notify_staff_absence_submitted ON staff_absence_requests;
CREATE TRIGGER trg_notify_staff_absence_submitted
AFTER INSERT
ON staff_absence_requests
FOR EACH ROW
EXECUTE FUNCTION notify_staff_absence_submitted();
