/*
  # Move VI-HEM data model into an app namespace

  The shared production Supabase instance hosts several apps. VI-HEM owns the
  vihem_* table namespace, vihem-* Edge Functions and vihem-* storage buckets.
*/

CREATE OR REPLACE FUNCTION pg_temp.vihem_rename_table(old_name text, new_name text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF to_regclass('public.' || new_name) IS NOT NULL THEN
    RETURN;
  END IF;

  IF to_regclass('public.' || old_name) IS NULL THEN
    RETURN;
  END IF;

  EXECUTE format('ALTER TABLE public.%I RENAME TO %I', old_name, new_name);
END;
$$;

SELECT pg_temp.vihem_rename_table('organisations', 'vihem_organisations');
SELECT pg_temp.vihem_rename_table('profiles', 'vihem_profiles');
SELECT pg_temp.vihem_rename_table('properties', 'vihem_properties');
SELECT pg_temp.vihem_rename_table('apartments', 'vihem_apartments');
SELECT pg_temp.vihem_rename_table('tenancies', 'vihem_tenancies');
SELECT pg_temp.vihem_rename_table('maintenance_requests', 'vihem_maintenance_requests');
SELECT pg_temp.vihem_rename_table('maintenance_request_comments', 'vihem_maintenance_request_comments');
SELECT pg_temp.vihem_rename_table('customer_projects', 'vihem_customer_projects');
SELECT pg_temp.vihem_rename_table('work_orders', 'vihem_work_orders');
SELECT pg_temp.vihem_rename_table('work_order_comments', 'vihem_work_order_comments');
SELECT pg_temp.vihem_rename_table('time_entries', 'vihem_time_entries');
SELECT pg_temp.vihem_rename_table('daily_work_summaries', 'vihem_daily_work_summaries');
SELECT pg_temp.vihem_rename_table('laundry_rooms', 'vihem_laundry_rooms');
SELECT pg_temp.vihem_rename_table('laundry_slots', 'vihem_laundry_slots');
SELECT pg_temp.vihem_rename_table('laundry_bookings', 'vihem_laundry_bookings');
SELECT pg_temp.vihem_rename_table('documents', 'vihem_documents');
SELECT pg_temp.vihem_rename_table('news', 'vihem_news');
SELECT pg_temp.vihem_rename_table('termination_requests', 'vihem_termination_requests');
SELECT pg_temp.vihem_rename_table('chat_threads', 'vihem_chat_threads');
SELECT pg_temp.vihem_rename_table('chat_messages', 'vihem_chat_messages');
SELECT pg_temp.vihem_rename_table('chat_participants', 'vihem_chat_participants');
SELECT pg_temp.vihem_rename_table('notifications', 'vihem_notifications');
SELECT pg_temp.vihem_rename_table('apartment_inspections', 'vihem_apartment_inspections');
SELECT pg_temp.vihem_rename_table('contract_signatures', 'vihem_contract_signatures');
SELECT pg_temp.vihem_rename_table('purchase_items', 'vihem_purchase_items');
SELECT pg_temp.vihem_rename_table('project_customers', 'vihem_project_customers');
SELECT pg_temp.vihem_rename_table('project_assignments', 'vihem_project_assignments');
SELECT pg_temp.vihem_rename_table('project_quote_versions', 'vihem_project_quote_versions');
SELECT pg_temp.vihem_rename_table('project_quote_lines', 'vihem_project_quote_lines');
SELECT pg_temp.vihem_rename_table('project_change_orders', 'vihem_project_change_orders');
SELECT pg_temp.vihem_rename_table('project_material_entries', 'vihem_project_material_entries');
SELECT pg_temp.vihem_rename_table('project_documents', 'vihem_project_documents');
SELECT pg_temp.vihem_rename_table('project_comments', 'vihem_project_comments');
SELECT pg_temp.vihem_rename_table('project_activity_log', 'vihem_project_activity_log');
SELECT pg_temp.vihem_rename_table('project_self_check_templates', 'vihem_project_self_check_templates');
SELECT pg_temp.vihem_rename_table('project_self_checks', 'vihem_project_self_checks');
SELECT pg_temp.vihem_rename_table('project_inspections', 'vihem_project_inspections');
SELECT pg_temp.vihem_rename_table('project_deviations', 'vihem_project_deviations');
SELECT pg_temp.vihem_rename_table('project_invoice_basis', 'vihem_project_invoice_basis');
SELECT pg_temp.vihem_rename_table('project_invoice_basis_lines', 'vihem_project_invoice_basis_lines');
SELECT pg_temp.vihem_rename_table('staff_absence_requests', 'vihem_staff_absence_requests');
SELECT pg_temp.vihem_rename_table('staff_work_schedules', 'vihem_staff_work_schedules');
SELECT pg_temp.vihem_rename_table('organisation_notification_settings', 'vihem_organisation_notification_settings');
SELECT pg_temp.vihem_rename_table('short_stay_units', 'vihem_short_stay_units');
SELECT pg_temp.vihem_rename_table('short_stay_bookings', 'vihem_short_stay_bookings');

CREATE OR REPLACE FUNCTION public.vihem_get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT role FROM public.vihem_profiles WHERE id = auth.uid()), '');
$$;

CREATE OR REPLACE FUNCTION public.vihem_get_my_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (SELECT organisation_id FROM public.vihem_profiles WHERE id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.vihem_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.vihem_get_my_role() IN ('admin', 'superadmin');
$$;

CREATE OR REPLACE FUNCTION public.vihem_is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.vihem_get_my_role() IN ('staff', 'admin', 'superadmin');
$$;

-- Keep legacy policy helpers correct after the table rename. Later cleanups can
-- move every policy expression to the app-prefixed helper names.
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.vihem_get_my_role();
$$;

CREATE OR REPLACE FUNCTION public.get_my_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.vihem_get_my_org_id();
$$;

CREATE OR REPLACE FUNCTION public.is_customer_projects_enabled(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT customer_projects_enabled
    FROM public.vihem_organisations
    WHERE id = org_id
      AND active = true
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.is_short_stay_enabled(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT short_stay_enabled
    FROM public.vihem_organisations
    WHERE id = org_id
      AND active = true
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.is_user_in_my_org(user_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.vihem_profiles
    WHERE id = user_uuid
      AND organisation_id = public.vihem_get_my_org_id()
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_chat_thread(thread_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.vihem_chat_threads ct
    WHERE ct.id = thread_uuid
      AND (
        ct.created_by = auth.uid()
        OR public.vihem_get_my_role() = 'superadmin'
        OR (
          public.vihem_get_my_role() IN ('staff', 'admin')
          AND ct.organisation_id = public.vihem_get_my_org_id()
        )
        OR ct.tenant_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.vihem_chat_participants cp
          WHERE cp.thread_id = ct.id
            AND cp.user_id = auth.uid()
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.prevent_multiple_tenants_in_chat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_user_role text;
BEGIN
  SELECT role INTO new_user_role
  FROM public.vihem_profiles
  WHERE id = NEW.user_id;

  IF new_user_role = 'tenant' AND EXISTS (
    SELECT 1
    FROM public.vihem_chat_participants cp
    JOIN public.vihem_profiles p ON p.id = cp.user_id
    WHERE cp.thread_id = NEW.thread_id
      AND cp.user_id <> NEW.user_id
      AND p.role = 'tenant'
  ) THEN
    RAISE EXCEPTION 'Hyresgäster kan inte delta i samma chatt med andra hyresgäster';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_multiple_tenants_in_chat_trigger ON public.vihem_chat_participants;
CREATE TRIGGER prevent_multiple_tenants_in_chat_trigger
  BEFORE INSERT OR UPDATE OF user_id, thread_id ON public.vihem_chat_participants
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_multiple_tenants_in_chat();

CREATE OR REPLACE FUNCTION public.is_assigned_to_customer_project(project_id uuid, user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.vihem_project_assignments pa
    WHERE pa.project_id = is_assigned_to_customer_project.project_id
      AND pa.user_id = is_assigned_to_customer_project.user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_customer_project(project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.vihem_customer_projects cp
    WHERE cp.id = project_id
      AND cp.organisation_id = public.vihem_get_my_org_id()
      AND public.is_customer_projects_enabled(cp.organisation_id)
      AND (
        public.vihem_get_my_role() IN ('admin', 'superadmin')
        OR cp.project_manager_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.vihem_project_assignments pa
          WHERE pa.project_id = cp.id
            AND pa.user_id = auth.uid()
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.refresh_customer_project_financials(project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  time_value numeric;
  material_cost numeric;
  material_value numeric;
  change_value numeric;
BEGIN
  SELECT COALESCE(SUM((te.total_minutes::numeric / 60) * COALESCE(cp.hourly_rate, 0)), 0)
  INTO time_value
  FROM public.vihem_time_entries te
  JOIN public.vihem_customer_projects cp ON cp.id = te.customer_project_id
  WHERE te.customer_project_id = project_id
    AND te.entry_type = 'work'
    AND te.project_billable = true;

  SELECT
    COALESCE(SUM(purchase_price * quantity), 0),
    COALESCE(SUM(CASE WHEN invoice_separately THEN sale_price * quantity ELSE 0 END), 0)
  INTO material_cost, material_value
  FROM public.vihem_project_material_entries
  WHERE vihem_project_material_entries.project_id = refresh_customer_project_financials.project_id;

  SELECT COALESCE(SUM(CASE WHEN billing_mode = 'deduction' THEN -actual_amount ELSE actual_amount END), 0)
  INTO change_value
  FROM public.vihem_project_change_orders
  WHERE vihem_project_change_orders.project_id = refresh_customer_project_financials.project_id
    AND status IN ('approved_by_customer','completed','invoiced');

  UPDATE public.vihem_customer_projects
  SET
    actual_cost = material_cost,
    approved_change_order_amount = change_value,
    invoiceable_amount = time_value + material_value + change_value,
    updated_at = now()
  WHERE id = refresh_customer_project_financials.project_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.populate_maintenance_request_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tenant_scope record;
  tenant_org uuid;
BEGIN
  IF NEW.tenant_id IS NOT NULL THEN
    SELECT t.property_id, t.apartment_id, t.organisation_id
    INTO tenant_scope
    FROM public.vihem_tenancies t
    WHERE t.tenant_id = NEW.tenant_id
      AND t.status = 'active'
    ORDER BY t.start_date DESC
    LIMIT 1;

    SELECT p.organisation_id
    INTO tenant_org
    FROM public.vihem_profiles p
    WHERE p.id = NEW.tenant_id;

    NEW.property_id := COALESCE(NEW.property_id, tenant_scope.property_id);
    NEW.apartment_id := COALESCE(NEW.apartment_id, tenant_scope.apartment_id);
    NEW.organisation_id := COALESCE(NEW.organisation_id, tenant_scope.organisation_id, tenant_org);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS populate_maintenance_request_scope_trigger ON public.vihem_maintenance_requests;
CREATE TRIGGER populate_maintenance_request_scope_trigger
  BEFORE INSERT OR UPDATE OF tenant_id, property_id, apartment_id, organisation_id
  ON public.vihem_maintenance_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.populate_maintenance_request_scope();

CREATE OR REPLACE FUNCTION public.notification_enabled(org_uuid uuid, setting_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT (settings ->> setting_key)::boolean
      FROM public.vihem_organisation_notification_settings
      WHERE organisation_id = org_uuid
    ),
    true
  );
$$;

CREATE OR REPLACE FUNCTION public.create_notification(
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
SET search_path = public
AS $$
BEGIN
  IF recipient_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.vihem_notifications (user_id, organisation_id, title, message, type, link)
  VALUES (recipient_id, org_uuid, notification_title, notification_message, notification_type, COALESCE(notification_link, ''));
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_work_order_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
            'workorders'
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
          'workorders'
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
            'workorders'
          );
        END IF;
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_work_order_change ON public.vihem_work_orders;
CREATE TRIGGER trg_notify_work_order_change
AFTER INSERT OR UPDATE OF assigned_to, assigned_to_ids
ON public.vihem_work_orders
FOR EACH ROW
EXECUTE FUNCTION public.notify_work_order_change();

CREATE OR REPLACE FUNCTION public.notify_maintenance_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  staff_record record;
BEGIN
  IF public.notification_enabled(NEW.organisation_id, 'maintenance_created_staff') THEN
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
        'maintenance'
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_maintenance_created ON public.vihem_maintenance_requests;
CREATE TRIGGER trg_notify_maintenance_created
AFTER INSERT
ON public.vihem_maintenance_requests
FOR EACH ROW
EXECUTE FUNCTION public.notify_maintenance_created();

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

  IF public.notification_enabled(thread_org, 'chat_message') THEN
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
        'chat'
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_chat_message_created ON public.vihem_chat_messages;
CREATE TRIGGER trg_notify_chat_message_created
AFTER INSERT
ON public.vihem_chat_messages
FOR EACH ROW
EXECUTE FUNCTION public.notify_chat_message_created();

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

DROP TRIGGER IF EXISTS trg_notify_staff_absence_submitted ON public.vihem_staff_absence_requests;
CREATE TRIGGER trg_notify_staff_absence_submitted
AFTER INSERT
ON public.vihem_staff_absence_requests
FOR EACH ROW
EXECUTE FUNCTION public.notify_staff_absence_submitted();

NOTIFY pgrst, 'reload schema';
