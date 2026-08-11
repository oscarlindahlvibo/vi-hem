-- Notify organisation staff when a tenant adds a public comment to a maintenance request.
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
    OR NEW.user_id IS DISTINCT FROM request_record.tenant_id
    OR NOT public.notification_enabled(request_record.organisation_id, 'maintenance_comment_staff') THEN
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
      'maintenance'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_maintenance_comment ON public.vihem_maintenance_request_comments;
CREATE TRIGGER trg_notify_maintenance_comment
AFTER INSERT ON public.vihem_maintenance_request_comments
FOR EACH ROW
EXECUTE FUNCTION public.notify_maintenance_comment();
