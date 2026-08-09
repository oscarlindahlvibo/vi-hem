/*
  # VI-HEM finance overdue invoices

  Marks unpaid customer invoices as overdue when due_date has passed.
  The function can be run manually by admin/superadmin or by a service-role
  edge function without an authenticated user.
*/

CREATE OR REPLACE FUNCTION public.vihem_refresh_overdue_invoices(target_organisation_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count integer := 0;
  my_role text;
  my_org_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    my_role := public.vihem_get_my_role();
    my_org_id := public.vihem_get_my_org_id();

    IF my_role = 'superadmin' THEN
      NULL;
    ELSIF my_role = 'admin' AND target_organisation_id IS NOT NULL AND target_organisation_id = my_org_id THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Not allowed to refresh overdue invoices';
    END IF;
  END IF;

  UPDATE public.vihem_invoices
  SET
    status = 'overdue',
    updated_at = now()
  WHERE status IN ('approved', 'sent', 'partially_paid')
    AND payment_status IN ('unpaid', 'partially_paid')
    AND due_date < CURRENT_DATE
    AND (target_organisation_id IS NULL OR organisation_id = target_organisation_id);

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;
