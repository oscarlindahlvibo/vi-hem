ALTER TABLE staff_absence_requests
  DROP CONSTRAINT IF EXISTS staff_absence_requests_absence_type_check;

ALTER TABLE staff_absence_requests
  ADD CONSTRAINT staff_absence_requests_absence_type_check
  CHECK (absence_type IN ('sick','vab','vacation','leave','unpaid_leave'));

ALTER TABLE staff_absence_requests
  ADD COLUMN IF NOT EXISTS start_time time,
  ADD COLUMN IF NOT EXISTS end_time time;

ALTER TABLE staff_absence_requests
  DROP CONSTRAINT IF EXISTS staff_absence_requests_time_check;

ALTER TABLE staff_absence_requests
  ADD CONSTRAINT staff_absence_requests_time_check
  CHECK (
    start_time IS NULL
    OR end_time IS NULL
    OR end_date > start_date
    OR end_time > start_time
  );

CREATE TABLE IF NOT EXISTS staff_work_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid REFERENCES organisations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  weekday integer NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  work_start time NOT NULL DEFAULT '08:00',
  work_end time NOT NULL DEFAULT '17:00',
  lunch_start time,
  lunch_minutes integer NOT NULL DEFAULT 45 CHECK (lunch_minutes BETWEEN 0 AND 240),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, weekday)
);

CREATE INDEX IF NOT EXISTS idx_staff_work_schedules_org ON staff_work_schedules(organisation_id);
CREATE INDEX IF NOT EXISTS idx_staff_work_schedules_user ON staff_work_schedules(user_id);

ALTER TABLE staff_work_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read own schedules" ON staff_work_schedules;
DROP POLICY IF EXISTS "Admins can manage org schedules" ON staff_work_schedules;

CREATE POLICY "Staff can read own schedules"
  ON staff_work_schedules FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND (organisation_id IS NULL OR organisation_id = get_my_org_id())
  );

CREATE POLICY "Admins can manage org schedules"
  ON staff_work_schedules FOR ALL
  TO authenticated
  USING (
    organisation_id = get_my_org_id()
    AND get_my_role() IN ('admin', 'superadmin')
  )
  WITH CHECK (
    organisation_id = get_my_org_id()
    AND get_my_role() IN ('admin', 'superadmin')
  );

CREATE TABLE IF NOT EXISTS organisation_notification_settings (
  organisation_id uuid PRIMARY KEY REFERENCES organisations(id) ON DELETE CASCADE,
  settings jsonb NOT NULL DEFAULT jsonb_build_object(
    'work_order_assigned', true,
    'work_order_unassigned', true,
    'maintenance_created_staff', true,
    'chat_message', true,
    'shift_start_reminder', true,
    'lunch_start_reminder', true,
    'lunch_return_reminder', true,
    'shift_end_reminder', true,
    'default_lunch_return_minutes', 45
  ),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE organisation_notification_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org users can read notification settings" ON organisation_notification_settings;
DROP POLICY IF EXISTS "Admins can manage notification settings" ON organisation_notification_settings;

CREATE POLICY "Org users can read notification settings"
  ON organisation_notification_settings FOR SELECT
  TO authenticated
  USING (organisation_id = get_my_org_id());

CREATE POLICY "Admins can manage notification settings"
  ON organisation_notification_settings FOR ALL
  TO authenticated
  USING (
    organisation_id = get_my_org_id()
    AND get_my_role() IN ('admin', 'superadmin')
  )
  WITH CHECK (
    organisation_id = get_my_org_id()
    AND get_my_role() IN ('admin', 'superadmin')
  );

INSERT INTO organisation_notification_settings (organisation_id)
SELECT id FROM organisations
ON CONFLICT (organisation_id) DO NOTHING;

CREATE OR REPLACE FUNCTION notification_enabled(org_uuid uuid, setting_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (
      SELECT (settings ->> setting_key)::boolean
      FROM organisation_notification_settings
      WHERE organisation_id = org_uuid
    ),
    true
  );
$$;

CREATE OR REPLACE FUNCTION create_notification(
  recipient_id uuid,
  org_uuid uuid,
  notification_title text,
  notification_message text,
  notification_type text,
  notification_link text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF recipient_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO notifications (user_id, organisation_id, title, message, type, link)
  VALUES (recipient_id, org_uuid, notification_title, notification_message, notification_type, COALESCE(notification_link, ''));
END;
$$;

CREATE OR REPLACE FUNCTION notify_work_order_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
      IF notification_enabled(NEW.organisation_id, 'work_order_unassigned') THEN
        FOR staff_record IN
          SELECT id FROM profiles
          WHERE organisation_id = NEW.organisation_id
            AND role IN ('staff', 'admin')
            AND active = true
        LOOP
          PERFORM create_notification(
            staff_record.id,
            NEW.organisation_id,
            'Ny otilldelad arbetsorder',
            NEW.title,
            'work_order',
            'workorders'
          );
        END LOOP;
      END IF;
    ELSIF notification_enabled(NEW.organisation_id, 'work_order_assigned') THEN
      FOREACH assignee_id IN ARRAY assigned_ids LOOP
        PERFORM create_notification(
          assignee_id,
          NEW.organisation_id,
          'Ny arbetsorder tilldelad',
          NEW.title,
          'work_order',
          'workorders'
        );
      END LOOP;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    assigned_ids := COALESCE(NEW.assigned_to_ids, '{}');
    IF NEW.assigned_to IS NOT NULL AND NOT (NEW.assigned_to = ANY(assigned_ids)) THEN
      assigned_ids := array_append(assigned_ids, NEW.assigned_to);
    END IF;

    IF notification_enabled(NEW.organisation_id, 'work_order_assigned') THEN
      FOREACH assignee_id IN ARRAY assigned_ids LOOP
        IF NOT (
          assignee_id = ANY(COALESCE(OLD.assigned_to_ids, '{}'))
          OR assignee_id = OLD.assigned_to
        ) THEN
          PERFORM create_notification(
            assignee_id,
            NEW.organisation_id,
            'Arbetsorder tilldelad',
            NEW.title,
            'work_order',
            'workorders'
          );
        END IF;
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_work_order_change ON work_orders;
CREATE TRIGGER trg_notify_work_order_change
AFTER INSERT OR UPDATE OF assigned_to, assigned_to_ids
ON work_orders
FOR EACH ROW
EXECUTE FUNCTION notify_work_order_change();

CREATE OR REPLACE FUNCTION notify_maintenance_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  staff_record record;
BEGIN
  IF notification_enabled(NEW.organisation_id, 'maintenance_created_staff') THEN
    FOR staff_record IN
      SELECT id FROM profiles
      WHERE organisation_id = NEW.organisation_id
        AND role IN ('staff', 'admin')
        AND active = true
    LOOP
      PERFORM create_notification(
        staff_record.id,
        NEW.organisation_id,
        'Ny felanmälan',
        NEW.title,
        'maintenance',
        'maintenance'
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_maintenance_created ON maintenance_requests;
CREATE TRIGGER trg_notify_maintenance_created
AFTER INSERT
ON maintenance_requests
FOR EACH ROW
EXECUTE FUNCTION notify_maintenance_created();

CREATE OR REPLACE FUNCTION notify_chat_message_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  thread_org uuid;
  participant_record record;
BEGIN
  SELECT organisation_id INTO thread_org
  FROM chat_threads
  WHERE id = NEW.thread_id;

  IF notification_enabled(thread_org, 'chat_message') THEN
    FOR participant_record IN
      SELECT user_id FROM chat_participants
      WHERE thread_id = NEW.thread_id
        AND user_id <> NEW.sender_id
    LOOP
      PERFORM create_notification(
        participant_record.user_id,
        thread_org,
        'Nytt chattmeddelande',
        LEFT(NEW.message, 120),
        'chat',
        'chat'
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_chat_message_created ON chat_messages;
CREATE TRIGGER trg_notify_chat_message_created
AFTER INSERT
ON chat_messages
FOR EACH ROW
EXECUTE FUNCTION notify_chat_message_created();
