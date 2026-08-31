-- Every trigger below gated an entire recipient loop with a single
-- upfront notification_enabled(org, key) check, so per-user preferences
-- (20260831110000) had nowhere to plug in -- move the check to each
-- create_notification() call via its new setting_key parameter instead,
-- so each recipient's own preference (falling back to the org's) is
-- respected individually.

CREATE OR REPLACE FUNCTION public.notify_work_order_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  staff_record record;
  assignee_id uuid;
  assigned_ids uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    assigned_ids := COALESCE(NEW.assigned_to_ids, '{}');
    IF NEW.assigned_to IS NOT NULL AND NOT (NEW.assigned_to = ANY(assigned_ids)) THEN
      assigned_ids := array_append(assigned_ids, NEW.assigned_to);
    END IF;

    IF array_length(assigned_ids, 1) IS NULL THEN
      FOR staff_record IN
        SELECT id FROM public.vihem_profiles
        WHERE organisation_id = NEW.organisation_id
          AND role IN ('staff', 'admin')
          AND active = true
      LOOP
        PERFORM public.create_notification(
          staff_record.id,
          NEW.organisation_id,
          'Ny otilldelad arbetsorder',
          NEW.title,
          'work_order',
          'workorder/' || NEW.id,
          'work_order_unassigned'
        );
      END LOOP;
    ELSE
      FOREACH assignee_id IN ARRAY assigned_ids LOOP
        PERFORM public.create_notification(
          assignee_id,
          NEW.organisation_id,
          'Ny arbetsorder tilldelad',
          NEW.title,
          'work_order',
          'workorder/' || NEW.id,
          'work_order_assigned'
        );
      END LOOP;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    assigned_ids := COALESCE(NEW.assigned_to_ids, '{}');
    IF NEW.assigned_to IS NOT NULL AND NOT (NEW.assigned_to = ANY(assigned_ids)) THEN
      assigned_ids := array_append(assigned_ids, NEW.assigned_to);
    END IF;

    FOREACH assignee_id IN ARRAY assigned_ids LOOP
      IF NOT (
        assignee_id = ANY(COALESCE(OLD.assigned_to_ids, '{}'))
        OR assignee_id = OLD.assigned_to
      ) THEN
        PERFORM public.create_notification(
          assignee_id,
          NEW.organisation_id,
          'Arbetsorder tilldelad',
          NEW.title,
          'work_order',
          'workorder/' || NEW.id,
          'work_order_assigned'
        );
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_fleet_damage_reported()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_vehicle record;
  v_reporter_name text;
  v_admin record;
BEGIN
  IF NEW.severity NOT IN ('urgent', 'no_use') THEN
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
      'fleet/' || NEW.vehicle_id,
      'fleet_damage_reported'
    );
  END LOOP;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_staff_absence_submitted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_record record;
  staff_name text;
  absence_label text;
BEGIN
  IF NEW.organisation_id IS NULL OR NEW.status <> 'submitted' THEN
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
      'timetracking',
      'staff_absence_submitted'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_maintenance_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_record record;
  staff_record record;
BEGIN
  SELECT id, organisation_id, tenant_id, title
  INTO request_record
  FROM public.vihem_maintenance_requests
  WHERE id = NEW.request_id;

  IF request_record.id IS NULL
    OR NEW.internal
    OR NEW.user_id IS DISTINCT FROM request_record.tenant_id THEN
    RETURN NEW;
  END IF;

  FOR staff_record IN
    SELECT id
    FROM public.vihem_profiles
    WHERE organisation_id = request_record.organisation_id
      AND role IN ('staff', 'admin')
      AND active = true
  LOOP
    PERFORM public.create_notification(
      staff_record.id,
      request_record.organisation_id,
      'Ny kommentar i felanmälan',
      COALESCE(request_record.title, 'En felanmälan') || ' har fått en kommentar från hyresgästen.',
      'maintenance',
      'maintenance',
      'maintenance_comment_staff'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_maintenance_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  staff_record record;
BEGIN
  FOR staff_record IN
    SELECT id FROM public.vihem_profiles
    WHERE organisation_id = NEW.organisation_id
      AND role IN ('staff', 'admin')
      AND active = true
  LOOP
    PERFORM public.create_notification(
      staff_record.id,
      NEW.organisation_id,
      'Ny felanmälan',
      NEW.title,
      'maintenance',
      'maintenance',
      'maintenance_created_staff'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_chat_message_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  thread_org uuid;
  participant_record record;
BEGIN
  SELECT organisation_id INTO thread_org
  FROM public.vihem_chat_threads
  WHERE id = NEW.thread_id;

  FOR participant_record IN
    SELECT user_id FROM public.vihem_chat_participants
    WHERE thread_id = NEW.thread_id
      AND user_id <> NEW.sender_id
  LOOP
    PERFORM public.create_notification(
      participant_record.user_id,
      thread_org,
      'Nytt chattmeddelande',
      LEFT(NEW.message, 120),
      'chat',
      'chat',
      'chat_message'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_jour_swap_offered()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift record;
  v_offerer_name text;
  v_eligible record;
  v_duty_label text;
BEGIN
  IF NEW.status <> 'open' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_shift FROM public.vihem_jour_shifts WHERE id = NEW.shift_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(name, email, 'Personal') INTO v_offerer_name FROM public.vihem_profiles WHERE id = NEW.offered_by;
  v_duty_label := CASE v_shift.duty_type WHEN 'fastighet' THEN 'fastighetsjour' WHEN 'sno' THEN 'snöjour' WHEN 'stad' THEN 'städjour' ELSE 'jour' END;

  FOR v_eligible IN
    SELECT e.user_id
    FROM public.vihem_jour_eligibility e
    WHERE e.organisation_id = NEW.organisation_id
      AND e.duty_type = v_shift.duty_type
      AND e.active = true
      AND e.user_id <> NEW.offered_by
  LOOP
    PERFORM public.create_notification(
      v_eligible.user_id,
      NEW.organisation_id,
      'Jourpass ute för byte',
      v_offerer_name || ' har lagt ut ett pass (' || v_duty_label || ') för byte.',
      'jour',
      'jour',
      'jour_swap_available'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
