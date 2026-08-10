/*
  # VI-HEM rent invoice email queue

  Adds a bulk queue helper for emailing all ready invoices in a rent billing
  run. It only queues approved/sent rent invoices that have a PDF document and
  a recipient address, and it avoids duplicate queued/sent invoice emails.
*/

CREATE OR REPLACE FUNCTION public.vihem_queue_rent_run_invoice_emails(target_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  run_row public.vihem_rent_billing_runs%ROWTYPE;
  invoice_row record;
  queued_count integer := 0;
  skipped_missing_document integer := 0;
  skipped_missing_email integer := 0;
  skipped_duplicate integer := 0;
  skipped_not_ready integer := 0;
BEGIN
  SELECT *
  INTO run_row
  FROM public.vihem_rent_billing_runs
  WHERE id = target_run_id;

  IF run_row.id IS NULL THEN
    RAISE EXCEPTION 'Rent billing run not found';
  END IF;

  IF NOT public.vihem_user_has_company_access(run_row.company_id, 'seller') THEN
    RAISE EXCEPTION 'Not allowed to queue rent invoice emails';
  END IF;

  FOR invoice_row IN
    SELECT
      i.*,
      c.name AS customer_name,
      COALESCE(NULLIF(c.invoice_email, ''), c.email) AS customer_email
    FROM public.vihem_rent_billing_items item
    JOIN public.vihem_invoices i ON i.id = item.invoice_id
    LEFT JOIN public.vihem_finance_customers c ON c.id = i.customer_id
    WHERE item.run_id = run_row.id
      AND item.status = 'invoiced'
    ORDER BY i.due_date ASC, i.created_at ASC
  LOOP
    IF invoice_row.status NOT IN ('approved', 'sent', 'partially_paid', 'paid', 'overdue') THEN
      skipped_not_ready := skipped_not_ready + 1;
      CONTINUE;
    END IF;

    IF invoice_row.document_id IS NULL THEN
      skipped_missing_document := skipped_missing_document + 1;
      CONTINUE;
    END IF;

    IF COALESCE(invoice_row.customer_email, '') = '' THEN
      skipped_missing_email := skipped_missing_email + 1;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.vihem_invoice_email_outbox outbox
      WHERE outbox.invoice_id = invoice_row.id
        AND outbox.email_kind = 'invoice'
        AND outbox.status IN ('queued', 'sent')
    ) THEN
      skipped_duplicate := skipped_duplicate + 1;
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
      email_kind
    )
    VALUES (
      invoice_row.organisation_id,
      invoice_row.company_id,
      invoice_row.id,
      invoice_row.document_id,
      lower(trim(invoice_row.customer_email)),
      COALESCE(invoice_row.customer_name, ''),
      'Hyresavi ' || COALESCE(invoice_row.invoice_number, invoice_row.id::text),
      'Hej! Här kommer hyresavin för ' || to_char(run_row.rent_period, 'YYYY-MM') ||
        ' som PDF. Förfallodatum är ' || invoice_row.due_date::text || '.',
      'queued',
      now(),
      auth.uid(),
      'invoice'
    );

    queued_count := queued_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'queued', queued_count,
    'skipped_missing_document', skipped_missing_document,
    'skipped_missing_email', skipped_missing_email,
    'skipped_duplicate', skipped_duplicate,
    'skipped_not_ready', skipped_not_ready
  );
END;
$$;

REVOKE ALL ON FUNCTION public.vihem_queue_rent_run_invoice_emails(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vihem_queue_rent_run_invoice_emails(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
