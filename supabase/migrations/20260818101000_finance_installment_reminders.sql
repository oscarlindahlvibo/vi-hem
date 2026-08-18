-- Queue installment reminders without creating invoices or accounting entries.

CREATE OR REPLACE FUNCTION public.vihem_queue_installment_reminders(
  target_organisation_id uuid DEFAULT NULL,
  target_before_days integer DEFAULT 3
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  queued_count integer := 0;
  my_role text;
  row_data record;
  reminder_kind text;
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
      RAISE EXCEPTION 'Not allowed to queue installment reminders';
    END IF;
  END IF;

  FOR row_data IN
    SELECT
      p.id AS plan_id,
      p.organisation_id,
      p.plan_number,
      p.company_id,
      p.customer_id,
      s.id AS schedule_id,
      s.installment_no,
      s.due_date,
      s.amount,
      COALESCE(NULLIF(c.invoice_email, ''), c.email) AS recipient_email,
      COALESCE(NULLIF(c.name, ''), 'kund') AS recipient_name,
      co.name AS company_name
    FROM public.vihem_installment_plans p
    JOIN public.vihem_installment_schedule s ON s.plan_id = p.id
    LEFT JOIN public.vihem_finance_customers c ON c.id = p.customer_id
    LEFT JOIN public.vihem_companies co ON co.id = p.company_id
    WHERE (target_organisation_id IS NULL OR p.organisation_id = target_organisation_id)
      AND p.status IN ('active', 'overdue')
      AND s.status IN ('pending', 'partially_paid', 'overdue')
      AND s.due_date <= CURRENT_DATE + GREATEST(COALESCE(target_before_days, 3), 0)
      AND COALESCE(NULLIF(c.invoice_email, ''), c.email, '') <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM public.vihem_installment_reminder_log existing
        WHERE existing.plan_id = p.id
          AND existing.schedule_id = s.id
          AND existing.sent_at::date = CURRENT_DATE
          AND existing.status IN ('queued', 'sent')
      )
    ORDER BY s.due_date ASC, p.plan_number ASC, s.installment_no ASC
  LOOP
    reminder_kind := CASE
      WHEN row_data.due_date < CURRENT_DATE THEN 'overdue'
      WHEN row_data.due_date = CURRENT_DATE THEN 'due_today'
      ELSE 'before_due'
    END;

    INSERT INTO public.vihem_installment_reminder_log (
      organisation_id,
      plan_id,
      schedule_id,
      reminder_type,
      sent_to,
      status
    ) VALUES (
      row_data.organisation_id,
      row_data.plan_id,
      row_data.schedule_id,
      reminder_kind,
      row_data.recipient_email,
      'queued'
    );
    queued_count := queued_count + 1;
  END LOOP;

  RETURN queued_count;
END;
$$;

REVOKE ALL ON FUNCTION public.vihem_queue_installment_reminders(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vihem_queue_installment_reminders(uuid, integer) TO authenticated;
