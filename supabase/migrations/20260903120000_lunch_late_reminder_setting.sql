-- New notification setting key (lunch_late_reminder) for the "still on
-- lunch after 50 minutes" nudge added to vihem-dispatch-scheduled-
-- notifications/index.ts. notification_enabled_for_user() already
-- defaults an absent key to true, but the edge function reads
-- settings.lunch_late_reminder directly with a plain JS truthy check, so
-- existing org rows (which predate this key) need it backfilled to true --
-- otherwise the reminder would silently never fire for any org that
-- existed before this migration.
UPDATE public.vihem_organisation_notification_settings
SET settings = settings || jsonb_build_object('lunch_late_reminder', true)
WHERE NOT (settings ? 'lunch_late_reminder');

ALTER TABLE public.vihem_organisation_notification_settings
  ALTER COLUMN settings SET DEFAULT jsonb_build_object(
    'work_order_assigned', true,
    'work_order_unassigned', true,
    'maintenance_created_staff', true,
    'chat_message', true,
    'shift_start_reminder', true,
    'lunch_start_reminder', true,
    'lunch_return_reminder', true,
    'lunch_late_reminder', true,
    'shift_end_reminder', true,
    'default_lunch_return_minutes', 45
  );
