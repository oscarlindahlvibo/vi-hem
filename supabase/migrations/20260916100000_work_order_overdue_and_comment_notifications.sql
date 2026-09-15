-- Two new work-order notifications:
--  1. "Arbetsorder försenad" -- a recurring reminder for every assignee of
--     an overdue (due_date passed, not completed/cancelled) work order,
--     sent by the weekday-07:00 check added to
--     vihem-dispatch-scheduled-notifications/index.ts. Uses the shared
--     vihem_notification_delivery_log dedup table (one delivery_key per
--     work order per day) so it fires once per weekday morning, not every
--     5-minute cron tick -- see createOnce() in that function.
--  2. "Ny kommentar på arbetsordern" -- fires on INSERT into
--     vihem_work_order_comments, notifying every assignee plus the work
--     order's creator (excluding whoever wrote the comment), following the
--     exact same assignee-union pattern already used by
--     notify_work_order_change() for the "tilldelad"/"otilldelad"
--     notifications on vihem_work_orders itself.

-- New setting keys -- notification_enabled_for_user() already defaults an
-- absent key to true, but vihem-dispatch-scheduled-notifications/index.ts
-- (like its existing shift/lunch reminders) reads settings.work_order_overdue
-- directly with a plain JS truthy check, so existing org rows need it
-- backfilled to true or the reminder would silently never fire for any org
-- that existed before this migration.
UPDATE public.vihem_organisation_notification_settings
SET settings = settings || jsonb_build_object('work_order_overdue', true, 'work_order_comment', true)
WHERE NOT (settings ? 'work_order_overdue') OR NOT (settings ? 'work_order_comment');

ALTER TABLE public.vihem_organisation_notification_settings
  ALTER COLUMN settings SET DEFAULT jsonb_build_object(
    'work_order_assigned', true,
    'work_order_unassigned', true,
    'work_order_overdue', true,
    'work_order_comment', true,
    'maintenance_created_staff', true,
    'chat_message', true,
    'shift_start_reminder', true,
    'lunch_start_reminder', true,
    'lunch_return_reminder', true,
    'lunch_late_reminder', true,
    'shift_end_reminder', true,
    'default_lunch_return_minutes', 45
  );

CREATE OR REPLACE FUNCTION public.notify_work_order_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  wo record;
  commenter_name text;
  assignee_id uuid;
  recipient_ids uuid[];
BEGIN
  SELECT id, organisation_id, title, created_by, assigned_to, assigned_to_ids
  INTO wo
  FROM public.vihem_work_orders
  WHERE id = NEW.work_order_id;

  IF wo.id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT name INTO commenter_name FROM public.vihem_profiles WHERE id = NEW.user_id;

  recipient_ids := COALESCE(wo.assigned_to_ids, '{}');
  IF wo.assigned_to IS NOT NULL AND NOT (wo.assigned_to = ANY(recipient_ids)) THEN
    recipient_ids := array_append(recipient_ids, wo.assigned_to);
  END IF;
  IF wo.created_by IS NOT NULL AND NOT (wo.created_by = ANY(recipient_ids)) THEN
    recipient_ids := array_append(recipient_ids, wo.created_by);
  END IF;

  FOREACH assignee_id IN ARRAY recipient_ids LOOP
    IF assignee_id IS DISTINCT FROM NEW.user_id THEN
      PERFORM public.create_notification(
        assignee_id,
        wo.organisation_id,
        'Ny kommentar: ' || COALESCE(wo.title, 'Arbetsorder'),
        COALESCE(commenter_name, 'Någon') || ' kommenterade: ' || left(NEW.comment, 140),
        'work_order',
        'workorder/' || wo.id,
        'work_order_comment'
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_work_order_comment ON public.vihem_work_order_comments;
CREATE TRIGGER trg_notify_work_order_comment
  AFTER INSERT ON public.vihem_work_order_comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_work_order_comment();

NOTIFY pgrst, 'reload schema';
