/*
  # Repair VI-HEM namespace login after shared Supabase deployment

  Some deployment scripts track migration state outside Supabase. If an earlier
  namespace migration was interrupted or skipped, the frontend may be deployed
  while the database still exposes the old table names. This migration repeats
  the critical idempotent table rename and profile RLS setup with a new version.
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

DO $$
BEGIN
  IF to_regclass('public.vihem_profiles') IS NOT NULL THEN
    ALTER TABLE public.vihem_profiles ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "VIHEM users can read own profile" ON public.vihem_profiles;
    CREATE POLICY "VIHEM users can read own profile"
      ON public.vihem_profiles FOR SELECT
      TO authenticated
      USING (auth.uid() = id);

    DROP POLICY IF EXISTS "VIHEM users can update own profile" ON public.vihem_profiles;
    CREATE POLICY "VIHEM users can update own profile"
      ON public.vihem_profiles FOR UPDATE
      TO authenticated
      USING (auth.uid() = id)
      WITH CHECK (auth.uid() = id);

    DROP POLICY IF EXISTS "VIHEM staff can read org profiles" ON public.vihem_profiles;
    CREATE POLICY "VIHEM staff can read org profiles"
      ON public.vihem_profiles FOR SELECT
      TO authenticated
      USING (
        public.vihem_get_my_role() = 'superadmin'
        OR (
          public.vihem_get_my_role() IN ('staff', 'admin')
          AND organisation_id = public.vihem_get_my_org_id()
        )
      );

    DROP POLICY IF EXISTS "VIHEM admins can insert profiles" ON public.vihem_profiles;
    CREATE POLICY "VIHEM admins can insert profiles"
      ON public.vihem_profiles FOR INSERT
      TO authenticated
      WITH CHECK (public.vihem_get_my_role() IN ('admin', 'superadmin'));

    DROP POLICY IF EXISTS "VIHEM admins can update profiles" ON public.vihem_profiles;
    CREATE POLICY "VIHEM admins can update profiles"
      ON public.vihem_profiles FOR UPDATE
      TO authenticated
      USING (public.vihem_get_my_role() IN ('admin', 'superadmin'))
      WITH CHECK (public.vihem_get_my_role() IN ('admin', 'superadmin'));
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
