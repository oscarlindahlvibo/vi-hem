/*
  # VI-HEM finance reminder settings

  Adds per-company reminder settings and makes the reminder queue respect them.
*/

CREATE TABLE IF NOT EXISTS public.vihem_finance_reminder_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.vihem_companies(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  first_after_days integer NOT NULL DEFAULT 1 CHECK (first_after_days >= 0),
  interval_days integer NOT NULL DEFAULT 7 CHECK (interval_days >= 1),
  max_reminders integer NOT NULL DEFAULT 3 CHECK (max_reminders >= 0),
  reminder_fee numeric(14,2) NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id)
);

CREATE INDEX IF NOT EXISTS vihem_finance_reminder_settings_org_idx
  ON public.vihem_finance_reminder_settings (organisation_id);

ALTER TABLE public.vihem_finance_reminder_settings ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS vihem_touch_updated_at_trigger ON public.vihem_finance_reminder_settings;
CREATE TRIGGER vihem_touch_updated_at_trigger
  BEFORE UPDATE ON public.vihem_finance_reminder_settings
  FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at();

DROP TRIGGER IF EXISTS vihem_finance_audit_trigger ON public.vihem_finance_reminder_settings;
CREATE TRIGGER vihem_finance_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.vihem_finance_reminder_settings
  FOR EACH ROW EXECUTE FUNCTION public.vihem_finance_audit_trigger();

DROP POLICY IF EXISTS "VIHEM finance reminder settings read" ON public.vihem_finance_reminder_settings;
CREATE POLICY "VIHEM finance reminder settings read"
  ON public.vihem_finance_reminder_settings FOR SELECT TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_user_has_company_access(company_id, 'viewer')
    )
  );

DROP POLICY IF EXISTS "VIHEM finance reminder settings write" ON public.vihem_finance_reminder_settings;
CREATE POLICY "VIHEM finance reminder settings write"
  ON public.vihem_finance_reminder_settings FOR ALL TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_user_has_company_access(company_id, 'admin')
    )
  )
  WITH CHECK (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_user_has_company_access(company_id, 'admin')
    )
  );

CREATE OR REPLACE FUNCTION public.vihem_queue_overdue_invoice_reminders(
  target_organisation_id uuid DEFAULT NULL,
  target_company_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  queued_count integer := 0;
  my_role text;
  invoice_row record;
  next_level integer;
  last_reminder_at timestamptz;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    my_role := public.vihem_get_my_role();

    IF my_role = 'superadmin' THEN
      NULL;
    ELSIF my_role = 'admin'
      AND target_organisation_id IS NOT NULL
      AND target_organisation_id = public.vihem_get_my_org_id() THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Not allowed to queue invoice reminders';
    END IF;
  END IF;

  PERFORM public.vihem_refresh_overdue_invoices(target_organisation_id);

  FOR invoice_row IN
    SELECT
      i.*,
      c.name AS customer_name,
      COALESCE(NULLIF(c.invoice_email, ''), c.email) AS customer_email,
      co.name AS company_name,
      COALESCE(rs.enabled, true) AS reminders_enabled,
      COALESCE(rs.first_after_days, 1) AS first_after_days,
      COALESCE(rs.interval_days, 7) AS interval_days,
      COALESCE(rs.max_reminders, 3) AS max_reminders
    FROM public.vihem_invoices i
    LEFT JOIN public.vihem_finance_customers c ON c.id = i.customer_id
    LEFT JOIN public.vihem_companies co ON co.id = i.company_id
    LEFT JOIN public.vihem_finance_reminder_settings rs ON rs.company_id = i.company_id
    WHERE (target_organisation_id IS NULL OR i.organisation_id = target_organisation_id)
      AND (target_company_id IS NULL OR i.company_id = target_company_id)
      AND i.status = 'overdue'
      AND i.payment_status IN ('unpaid', 'partially_paid')
      AND i.document_id IS NOT NULL
      AND COALESCE(rs.enabled, true) = true
      AND COALESCE(rs.max_reminders, 3) > 0
      AND i.due_date <= (CURRENT_DATE - COALESCE(rs.first_after_days, 1))
      AND COALESCE(NULLIF(c.invoice_email, ''), c.email, '') <> ''
    ORDER BY i.due_date ASC, i.created_at ASC
  LOOP
    SELECT
      COALESCE(MAX(reminder_level), 0) + 1,
      MAX(created_at)
    INTO next_level, last_reminder_at
    FROM public.vihem_invoice_email_outbox
    WHERE invoice_id = invoice_row.id
      AND email_kind = 'payment_reminder'
      AND status IN ('queued', 'sent');

    IF next_level > invoice_row.max_reminders THEN
      CONTINUE;
    END IF;

    IF last_reminder_at IS NOT NULL
      AND last_reminder_at::date > (CURRENT_DATE - invoice_row.interval_days) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.vihem_invoice_email_outbox (
      organisation_id,
      company_id,
      invoice_id,
      document_id,
      recipient_email,
      recipient_name,
      subject,
      message,
      status,
      queued_at,
      created_by,
      email_kind,
      reminder_level,
      reminder_due_date
    )
    VALUES (
      invoice_row.organisation_id,
      invoice_row.company_id,
      invoice_row.id,
      invoice_row.document_id,
      lower(trim(invoice_row.customer_email)),
      COALESCE(invoice_row.customer_name, ''),
      'Påminnelse ' || next_level::text || ' - faktura ' || COALESCE(invoice_row.invoice_number, invoice_row.id::text),
      'Hej! Vi saknar betalning för faktura ' || COALESCE(invoice_row.invoice_number, invoice_row.id::text) ||
        ' som förföll ' || invoice_row.due_date::text || '. Vänligen betala fakturan snarast eller kontakta oss om något inte stämmer.',
      'queued',
      now(),
      auth.uid(),
      'payment_reminder',
      next_level,
      invoice_row.due_date
    );

    queued_count := queued_count + 1;
  END LOOP;

  RETURN queued_count;
END;
$$;

REVOKE ALL ON FUNCTION public.vihem_queue_overdue_invoice_reminders(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vihem_queue_overdue_invoice_reminders(uuid, uuid) TO authenticated;
