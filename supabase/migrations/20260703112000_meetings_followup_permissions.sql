/*
  # Meetings & follow-up permissions

  Keeps meeting data visible to the organisation, but reserves meeting
  administration, protocols, decisions, action items and AI approvals for
  admins/superadmins.
*/

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'vihem_meeting_templates',
    'vihem_meetings',
    'vihem_meeting_agenda_items',
    'vihem_meeting_notes',
    'vihem_meeting_decisions',
    'vihem_meeting_action_items',
    'vihem_meeting_protocol_rows',
    'vihem_meeting_object_links',
    'vihem_ai_suggestions'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "VIHEM org users can read" ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY "VIHEM org users can read" ON public.%I FOR SELECT TO authenticated USING (public.vihem_get_my_role() = ''superadmin'' OR organisation_id = public.vihem_get_my_org_id())',
      table_name
    );

    EXECUTE format('DROP POLICY IF EXISTS "VIHEM staff can insert org rows" ON public.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "VIHEM staff can update org rows" ON public.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "VIHEM admins can delete org rows" ON public.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "VIHEM meeting admins can insert" ON public.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "VIHEM meeting admins can update" ON public.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "VIHEM meeting admins can delete" ON public.%I', table_name);

    EXECUTE format(
      'CREATE POLICY "VIHEM meeting admins can insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.vihem_get_my_role() = ''superadmin'' OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() = ''admin''))',
      table_name
    );

    EXECUTE format(
      'CREATE POLICY "VIHEM meeting admins can update" ON public.%I FOR UPDATE TO authenticated USING (public.vihem_get_my_role() = ''superadmin'' OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() = ''admin'')) WITH CHECK (public.vihem_get_my_role() = ''superadmin'' OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() = ''admin''))',
      table_name
    );

    EXECUTE format(
      'CREATE POLICY "VIHEM meeting admins can delete" ON public.%I FOR DELETE TO authenticated USING (public.vihem_get_my_role() = ''superadmin'' OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() = ''admin''))',
      table_name
    );
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
