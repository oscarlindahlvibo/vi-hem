-- Tapping a notification now actually navigates (see NotificationsPage.tsx
-- and the new pushNotificationActionPerformed handling in
-- src/lib/nativePush.ts), which exposed that work order and fleet damage
-- notifications only ever linked to the generic list page ('workorders',
-- 'fleet') instead of the specific record they're about, even though the
-- app has deep-link routes for both (workorder/<id> in src/App.tsx,
-- fleet/<id> already used by FleetPage). Point them at the actual record.
--
-- Left unchanged: maintenance, chat, absence, and jour notifications still
-- link to their list page -- those pages have no deep-link-to-one-record
-- support yet, so a more specific link would just be a dead end.
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
      IF public.notification_enabled(NEW.organisation_id, 'work_order_unassigned') THEN
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
            'workorder/' || NEW.id
          );
        END LOOP;
      END IF;
    ELSIF public.notification_enabled(NEW.organisation_id, 'work_order_assigned') THEN
      FOREACH assignee_id IN ARRAY assigned_ids LOOP
        PERFORM public.create_notification(
          assignee_id,
          NEW.organisation_id,
          'Ny arbetsorder tilldelad',
          NEW.title,
          'work_order',
          'workorder/' || NEW.id
        );
      END LOOP;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    assigned_ids := COALESCE(NEW.assigned_to_ids, '{}');
    IF NEW.assigned_to IS NOT NULL AND NOT (NEW.assigned_to = ANY(assigned_ids)) THEN
      assigned_ids := array_append(assigned_ids, NEW.assigned_to);
    END IF;

    IF public.notification_enabled(NEW.organisation_id, 'work_order_assigned') THEN
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
            'workorder/' || NEW.id
          );
        END IF;
      END LOOP;
    END IF;
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
  IF NOT public.notification_enabled(NEW.organisation_id, 'fleet_damage_reported') THEN
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
      'fleet/' || NEW.vehicle_id
    );
  END LOOP;

  RETURN NEW;
END;
$function$;
