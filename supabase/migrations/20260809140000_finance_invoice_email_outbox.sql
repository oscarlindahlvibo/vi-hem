/*
  # VI-HEM finance invoice email outbox

  Adds a controlled queue for invoice emails. The frontend can prepare and
  queue an invoice email, while the actual mail transport can be handled by a
  later edge function using SMTP/Postfix or another provider.
*/

CREATE TABLE IF NOT EXISTS public.vihem_invoice_email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.vihem_companies(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL REFERENCES public.vihem_invoices(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.vihem_documents(id) ON DELETE SET NULL,
  recipient_email text NOT NULL DEFAULT '',
  recipient_name text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  message text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'queued', 'sent', 'failed', 'cancelled')),
  queued_at timestamptz,
  sent_at timestamptz,
  error_message text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vihem_invoice_email_outbox_org_status_idx
  ON public.vihem_invoice_email_outbox (organisation_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS vihem_invoice_email_outbox_invoice_idx
  ON public.vihem_invoice_email_outbox (invoice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vihem_invoice_email_outbox_company_idx
  ON public.vihem_invoice_email_outbox (company_id, created_at DESC);

ALTER TABLE public.vihem_invoice_email_outbox ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS vihem_touch_updated_at_trigger ON public.vihem_invoice_email_outbox;
CREATE TRIGGER vihem_touch_updated_at_trigger
  BEFORE UPDATE ON public.vihem_invoice_email_outbox
  FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at();

DROP TRIGGER IF EXISTS vihem_finance_audit_trigger ON public.vihem_invoice_email_outbox;
CREATE TRIGGER vihem_finance_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.vihem_invoice_email_outbox
  FOR EACH ROW EXECUTE FUNCTION public.vihem_finance_audit_trigger();

DROP POLICY IF EXISTS "VIHEM finance invoice email read" ON public.vihem_invoice_email_outbox;
CREATE POLICY "VIHEM finance invoice email read"
  ON public.vihem_invoice_email_outbox FOR SELECT TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_user_has_company_access(company_id, 'viewer')
    )
  );

DROP POLICY IF EXISTS "VIHEM finance invoice email insert" ON public.vihem_invoice_email_outbox;
CREATE POLICY "VIHEM finance invoice email insert"
  ON public.vihem_invoice_email_outbox FOR INSERT TO authenticated
  WITH CHECK (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_user_has_company_access(company_id, 'seller')
    )
  );

DROP POLICY IF EXISTS "VIHEM finance invoice email update" ON public.vihem_invoice_email_outbox;
CREATE POLICY "VIHEM finance invoice email update"
  ON public.vihem_invoice_email_outbox FOR UPDATE TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_user_has_company_access(company_id, 'seller')
    )
  )
  WITH CHECK (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_user_has_company_access(company_id, 'seller')
    )
  );

DROP POLICY IF EXISTS "VIHEM finance invoice email delete" ON public.vihem_invoice_email_outbox;
CREATE POLICY "VIHEM finance invoice email delete"
  ON public.vihem_invoice_email_outbox FOR DELETE TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_user_has_company_access(company_id, 'admin')
    )
  );

CREATE OR REPLACE FUNCTION public.vihem_queue_invoice_email(
  target_invoice_id uuid,
  recipient_email text,
  recipient_name text DEFAULT '',
  email_subject text DEFAULT '',
  email_message text DEFAULT ''
)
RETURNS public.vihem_invoice_email_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invoice_row public.vihem_invoices%ROWTYPE;
  customer_row public.vihem_finance_customers%ROWTYPE;
  outbox_row public.vihem_invoice_email_outbox%ROWTYPE;
  clean_email text;
BEGIN
  SELECT *
  INTO invoice_row
  FROM public.vihem_invoices
  WHERE id = target_invoice_id;

  IF invoice_row.id IS NULL THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF NOT public.vihem_user_has_company_access(invoice_row.company_id, 'seller') THEN
    RAISE EXCEPTION 'Not allowed to queue invoice emails';
  END IF;

  IF invoice_row.status NOT IN ('approved', 'sent', 'partially_paid', 'paid', 'overdue') THEN
    RAISE EXCEPTION 'Only approved or sent invoices can be emailed';
  END IF;

  IF invoice_row.document_id IS NULL THEN
    RAISE EXCEPTION 'Invoice document is missing';
  END IF;

  IF invoice_row.customer_id IS NOT NULL THEN
    SELECT *
    INTO customer_row
    FROM public.vihem_finance_customers
    WHERE id = invoice_row.customer_id;
  END IF;

  clean_email := lower(trim(COALESCE(NULLIF(recipient_email, ''), customer_row.invoice_email, customer_row.email, '')));

  IF clean_email = '' OR clean_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' THEN
    RAISE EXCEPTION 'Valid recipient email is required';
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
    created_by
  )
  VALUES (
    invoice_row.organisation_id,
    invoice_row.company_id,
    invoice_row.id,
    invoice_row.document_id,
    clean_email,
    trim(COALESCE(NULLIF(recipient_name, ''), customer_row.name, '')),
    trim(COALESCE(NULLIF(email_subject, ''), 'Faktura ' || COALESCE(invoice_row.invoice_number, invoice_row.id::text))),
    trim(COALESCE(NULLIF(email_message, ''), 'Hej! Här kommer fakturan som PDF.')),
    'queued',
    now(),
    auth.uid()
  )
  RETURNING * INTO outbox_row;

  RETURN outbox_row;
END;
$$;
