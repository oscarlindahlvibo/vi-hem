/*
  # VI-HEM finance invoice reminders

  Adds payment reminder metadata to the invoice email outbox and a controlled
  function for queueing reminders for overdue unpaid customer invoices.
*/

ALTER TABLE public.vihem_invoice_email_outbox
  ADD COLUMN IF NOT EXISTS email_kind text NOT NULL DEFAULT 'invoice',
  ADD COLUMN IF NOT EXISTS reminder_level integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reminder_due_date date;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'vihem_invoice_email_outbox_email_kind_check'
      AND conrelid = 'public.vihem_invoice_email_outbox'::regclass
  ) THEN
    ALTER TABLE public.vihem_invoice_email_outbox
      ADD CONSTRAINT vihem_invoice_email_outbox_email_kind_check
      CHECK (email_kind IN ('invoice', 'payment_reminder'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS vihem_invoice_email_outbox_reminder_idx
  ON public.vihem_invoice_email_outbox (invoice_id, email_kind, reminder_level, created_at DESC);

CREATE OR REPLACE FUNCTION public.vihem_queue_overdue_invoice_reminders(
  target_organisation_id uuid,
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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not allowed to queue invoice reminders';
  END IF;

  my_role := public.vihem_get_my_role();

  IF my_role = 'superadmin' THEN
    NULL;
  ELSIF my_role = 'admin' AND target_organisation_id = public.vihem_get_my_org_id() THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'Not allowed to queue invoice reminders';
  END IF;

  PERFORM public.vihem_refresh_overdue_invoices(target_organisation_id);

  FOR invoice_row IN
    SELECT
      i.*,
      c.name AS customer_name,
      COALESCE(NULLIF(c.invoice_email, ''), c.email) AS customer_email,
      co.name AS company_name
    FROM public.vihem_invoices i
    LEFT JOIN public.vihem_finance_customers c ON c.id = i.customer_id
    LEFT JOIN public.vihem_companies co ON co.id = i.company_id
    WHERE i.organisation_id = target_organisation_id
      AND (target_company_id IS NULL OR i.company_id = target_company_id)
      AND i.status = 'overdue'
      AND i.payment_status IN ('unpaid', 'partially_paid')
      AND i.document_id IS NOT NULL
      AND COALESCE(NULLIF(c.invoice_email, ''), c.email, '') <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM public.vihem_invoice_email_outbox outbox
        WHERE outbox.invoice_id = i.id
          AND outbox.email_kind = 'payment_reminder'
          AND outbox.status IN ('queued', 'sent')
          AND outbox.created_at::date = CURRENT_DATE
      )
    ORDER BY i.due_date ASC, i.created_at ASC
  LOOP
    SELECT COALESCE(MAX(reminder_level), 0) + 1
    INTO next_level
    FROM public.vihem_invoice_email_outbox
    WHERE invoice_id = invoice_row.id
      AND email_kind = 'payment_reminder';

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
      'Påminnelse faktura ' || COALESCE(invoice_row.invoice_number, invoice_row.id::text),
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
