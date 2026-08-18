-- Repair migration for installations where one or more installment migrations
-- were marked as applied without creating every database object.

CREATE TABLE IF NOT EXISTS public.vihem_installment_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.vihem_companies(id) ON DELETE RESTRICT,
  customer_id uuid REFERENCES public.vihem_finance_customers(id) ON DELETE SET NULL,
  plan_number text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'active', 'overdue', 'completed', 'paused', 'cancelled')),
  total_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  paid_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  remaining_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (remaining_amount >= 0),
  installment_count integer NOT NULL DEFAULT 1 CHECK (installment_count > 0),
  first_due_date date NOT NULL,
  interval_months integer NOT NULL DEFAULT 1 CHECK (interval_months > 0),
  day_of_month integer NOT NULL DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 31),
  payment_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (payment_amount >= 0),
  terms text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  pause_reason text,
  approved_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  accounting_exportable boolean NOT NULL DEFAULT false CHECK (accounting_exportable = false),
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, plan_number)
);

ALTER TABLE public.vihem_installment_plans
  ADD COLUMN IF NOT EXISTS email_lead_days integer NOT NULL DEFAULT 30;

ALTER TABLE public.vihem_finance_customers
  ADD COLUMN IF NOT EXISTS personal_number text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS public.vihem_installment_plan_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.vihem_installment_plans(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES public.vihem_invoices(id) ON DELETE RESTRICT,
  source_type text NOT NULL CHECK (source_type IN ('original', 'external')),
  external_invoice_number text,
  external_invoice_date date,
  external_due_date date,
  description text NOT NULL DEFAULT '',
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  balance_remaining numeric(14,2) NOT NULL CHECK (balance_remaining >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((source_type = 'original' AND invoice_id IS NOT NULL) OR (source_type = 'external' AND invoice_id IS NULL))
);

CREATE TABLE IF NOT EXISTS public.vihem_installment_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.vihem_installment_plans(id) ON DELETE CASCADE,
  installment_no integer NOT NULL CHECK (installment_no > 0),
  due_date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  paid_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partially_paid', 'paid', 'overdue', 'paused', 'cancelled')),
  payment_reference text,
  invoice_id uuid REFERENCES public.vihem_invoices(id) ON DELETE RESTRICT,
  email_send_date date,
  email_status text NOT NULL DEFAULT 'pending',
  email_sent_at timestamptz,
  email_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, installment_no)
);

ALTER TABLE public.vihem_installment_schedule
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.vihem_invoices(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS email_send_date date,
  ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_error text;

CREATE TABLE IF NOT EXISTS public.vihem_installment_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.vihem_installment_plans(id) ON DELETE CASCADE,
  payment_number text NOT NULL,
  payment_date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL DEFAULT 'bank_transfer' CHECK (payment_method IN ('bank_transfer', 'card', 'cash', 'swish', 'other')),
  reference text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  accounting_exportable boolean NOT NULL DEFAULT false CHECK (accounting_exportable = false),
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, payment_number)
);

CREATE TABLE IF NOT EXISTS public.vihem_installment_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES public.vihem_installment_payments(id) ON DELETE CASCADE,
  plan_invoice_id uuid NOT NULL REFERENCES public.vihem_installment_plan_invoices(id) ON DELETE RESTRICT,
  invoice_id uuid REFERENCES public.vihem_invoices(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vihem_installment_payment_allocations
  ADD COLUMN IF NOT EXISTS organisation_id uuid REFERENCES public.vihem_organisations(id) ON DELETE CASCADE;

UPDATE public.vihem_installment_payment_allocations a
SET organisation_id = p.organisation_id
FROM public.vihem_installment_payments ip
JOIN public.vihem_installment_plans p ON p.id = ip.plan_id
WHERE a.payment_id = ip.id AND a.organisation_id IS NULL;

ALTER TABLE public.vihem_installment_payment_allocations
  ALTER COLUMN organisation_id SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.vihem_installment_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.vihem_installment_plans(id) ON DELETE CASCADE,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vihem_installment_reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.vihem_installment_plans(id) ON DELETE CASCADE,
  schedule_id uuid REFERENCES public.vihem_installment_schedule(id) ON DELETE CASCADE,
  reminder_type text NOT NULL CHECK (reminder_type IN ('before_due', 'due_today', 'overdue', 'manual')),
  sent_to text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  error text
);

CREATE TABLE IF NOT EXISTS public.vihem_installment_plan_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.vihem_installment_plans(id) ON DELETE CASCADE,
  payment_id uuid REFERENCES public.vihem_installment_payments(id) ON DELETE SET NULL,
  document_type text NOT NULL DEFAULT 'attachment' CHECK (document_type IN ('payment_underlay', 'attachment')),
  title text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL DEFAULT 'application/octet-stream',
  storage_bucket text NOT NULL DEFAULT 'vihem-documents',
  storage_path text NOT NULL,
  size_bytes bigint,
  drive_file_id text,
  drive_web_url text,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS vihem_installment_plan_invoice_unique
  ON public.vihem_installment_plan_invoices(plan_id, invoice_id)
  WHERE invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vihem_installment_plans_org_status_idx ON public.vihem_installment_plans(organisation_id, status);
CREATE INDEX IF NOT EXISTS vihem_installment_plan_invoices_plan_idx ON public.vihem_installment_plan_invoices(plan_id);
CREATE INDEX IF NOT EXISTS vihem_installment_schedule_due_idx ON public.vihem_installment_schedule(organisation_id, due_date, status);
CREATE INDEX IF NOT EXISTS vihem_installment_schedule_invoice_idx ON public.vihem_installment_schedule(invoice_id);
CREATE INDEX IF NOT EXISTS vihem_installment_schedule_email_queue_idx ON public.vihem_installment_schedule(email_status, email_send_date);
CREATE INDEX IF NOT EXISTS vihem_installment_payments_plan_date_idx ON public.vihem_installment_payments(plan_id, payment_date);
CREATE INDEX IF NOT EXISTS vihem_installment_audit_plan_created_idx ON public.vihem_installment_audit_log(plan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vihem_installment_plan_documents_plan_idx ON public.vihem_installment_plan_documents(plan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vihem_installment_plan_documents_payment_idx ON public.vihem_installment_plan_documents(payment_id);

UPDATE public.vihem_installment_schedule s
SET email_send_date = s.due_date - p.email_lead_days
FROM public.vihem_installment_plans p
WHERE p.id = s.plan_id AND s.email_send_date IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.vihem_installment_plans'::regclass AND conname = 'vihem_installment_plans_email_lead_days_check') THEN
    ALTER TABLE public.vihem_installment_plans ADD CONSTRAINT vihem_installment_plans_email_lead_days_check CHECK (email_lead_days >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.vihem_installment_schedule'::regclass AND conname = 'vihem_installment_schedule_email_status_check') THEN
    ALTER TABLE public.vihem_installment_schedule ADD CONSTRAINT vihem_installment_schedule_email_status_check CHECK (email_status IN ('pending', 'queued', 'sent', 'failed', 'skipped')) NOT VALID;
  END IF;
END $$;

DO $$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'vihem_installment_plans',
    'vihem_installment_plan_invoices',
    'vihem_installment_schedule',
    'vihem_installment_payments',
    'vihem_installment_payment_allocations',
    'vihem_installment_audit_log',
    'vihem_installment_reminder_log',
    'vihem_installment_plan_documents'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'VIHEM ' || relation_name || ' org access', relation_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (public.vihem_get_my_role() = ''superadmin'' OR organisation_id = public.vihem_get_my_org_id()) WITH CHECK (public.vihem_get_my_role() IN (''staff'', ''admin'', ''superadmin'') AND (public.vihem_get_my_role() = ''superadmin'' OR organisation_id = public.vihem_get_my_org_id()))',
      'VIHEM ' || relation_name || ' org access', relation_name
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', relation_name);
  END LOOP;
END $$;

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
    ELSIF my_role = 'admin' AND target_organisation_id IS NOT NULL AND target_organisation_id = public.vihem_get_my_org_id() THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Not allowed to queue installment reminders';
    END IF;
  END IF;

  FOR row_data IN
    SELECT p.id AS plan_id, p.organisation_id, p.plan_number, s.id AS schedule_id,
      s.installment_no, s.due_date, s.amount,
      COALESCE(NULLIF(c.invoice_email, ''), c.email) AS recipient_email
    FROM public.vihem_installment_plans p
    JOIN public.vihem_installment_schedule s ON s.plan_id = p.id
    LEFT JOIN public.vihem_finance_customers c ON c.id = p.customer_id
    WHERE (target_organisation_id IS NULL OR p.organisation_id = target_organisation_id)
      AND p.status IN ('active', 'overdue')
      AND s.status IN ('pending', 'partially_paid', 'overdue')
      AND COALESCE(s.email_send_date, s.due_date - COALESCE(p.email_lead_days, 30)) <= CURRENT_DATE
      AND s.email_status IN ('pending', 'failed')
      AND COALESCE(NULLIF(c.invoice_email, ''), c.email, '') <> ''
      AND NOT EXISTS (
        SELECT 1 FROM public.vihem_installment_reminder_log existing
        WHERE existing.plan_id = p.id AND existing.schedule_id = s.id
          AND existing.sent_at::date = CURRENT_DATE AND existing.status IN ('queued', 'sent')
      )
    ORDER BY s.due_date, p.plan_number, s.installment_no
  LOOP
    reminder_kind := CASE WHEN row_data.due_date < CURRENT_DATE THEN 'overdue' WHEN row_data.due_date = CURRENT_DATE THEN 'due_today' ELSE 'before_due' END;
    INSERT INTO public.vihem_installment_reminder_log (organisation_id, plan_id, schedule_id, reminder_type, sent_to, status)
    VALUES (row_data.organisation_id, row_data.plan_id, row_data.schedule_id, reminder_kind, row_data.recipient_email, 'queued');
    UPDATE public.vihem_installment_schedule SET email_status = 'queued', email_error = NULL WHERE id = row_data.schedule_id;
    queued_count := queued_count + 1;
  END LOOP;
  RETURN queued_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.vihem_generate_installment_invoice(p_schedule_id uuid)
RETURNS public.vihem_invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_schedule public.vihem_installment_schedule;
  v_plan public.vihem_installment_plans;
  v_invoice public.vihem_invoices;
BEGIN
  IF NOT public.vihem_is_admin() THEN RAISE EXCEPTION 'Endast administratörer får skapa fakturautkast.'; END IF;
  SELECT * INTO v_schedule FROM public.vihem_installment_schedule WHERE id = p_schedule_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Delbetalningen hittades inte.'; END IF;
  SELECT * INTO v_plan FROM public.vihem_installment_plans WHERE id = v_schedule.plan_id;
  IF NOT FOUND OR v_plan.organisation_id <> public.vihem_get_my_org_id() THEN RAISE EXCEPTION 'Avbetalningsplanen är inte tillgänglig.'; END IF;
  IF v_schedule.invoice_id IS NOT NULL THEN
    SELECT * INTO v_invoice FROM public.vihem_invoices WHERE id = v_schedule.invoice_id;
    RETURN v_invoice;
  END IF;
  INSERT INTO public.vihem_invoices (
    organisation_id, company_id, customer_id, invoice_date, due_date, payment_terms_days,
    currency, status, accounting_status, payment_status, source_type, source_id,
    subtotal_amount, vat_amount, total_amount, paid_amount, notes, created_by
  ) VALUES (
    v_plan.organisation_id, v_plan.company_id, v_plan.customer_id, CURRENT_DATE, v_schedule.due_date,
    GREATEST(v_schedule.due_date - CURRENT_DATE, 0), 'SEK', 'draft', 'not_synced', 'unpaid',
    'installment_plan', v_plan.id, v_schedule.amount, 0, v_schedule.amount, 0,
    format('Avbetalningsplan %s, del %s', v_plan.plan_number, v_schedule.installment_no), auth.uid()
  ) RETURNING * INTO v_invoice;
  INSERT INTO public.vihem_invoice_lines (
    organisation_id, company_id, invoice_id, line_no, description, quantity, unit, unit_price,
    vat_rate, line_type, line_total_excl_vat, vat_amount, line_total_incl_vat, metadata
  ) VALUES (
    v_plan.organisation_id, v_plan.company_id, v_invoice.id,
    1, format('Delbetalning %s av %s', v_schedule.installment_no, v_plan.plan_number),
    1, 'st', v_schedule.amount, 0, 'fee', v_schedule.amount, 0, v_schedule.amount,
    jsonb_build_object('plan_id', v_plan.id, 'schedule_id', v_schedule.id)
  );
  UPDATE public.vihem_installment_schedule SET invoice_id = v_invoice.id, updated_at = now() WHERE id = v_schedule.id;
  INSERT INTO public.vihem_installment_audit_log (organisation_id, plan_id, action, metadata, created_by)
  VALUES (v_plan.organisation_id, v_plan.id, 'invoice_draft_created', jsonb_build_object('invoice_id', v_invoice.id, 'schedule_id', v_schedule.id), auth.uid());
  RETURN v_invoice;
END;
$$;

CREATE OR REPLACE FUNCTION public.vihem_delete_installment_plan(p_plan_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_org uuid; v_invoice_ids uuid[];
BEGIN
  IF NOT public.vihem_is_admin() THEN RAISE EXCEPTION 'Endast administratörer får radera avbetalningsplaner.'; END IF;
  SELECT organisation_id INTO v_org FROM public.vihem_installment_plans WHERE id = p_plan_id;
  IF v_org IS NULL OR v_org <> public.vihem_get_my_org_id() THEN RAISE EXCEPTION 'Avbetalningsplanen är inte tillgänglig.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.vihem_invoices i JOIN public.vihem_installment_schedule s ON s.invoice_id = i.id
    WHERE s.plan_id = p_plan_id AND i.status NOT IN ('draft', 'cancelled')
  ) THEN RAISE EXCEPTION 'Avbetalningsplanen kan inte raderas eftersom en genererad faktura redan är skickad eller bokförd.'; END IF;
  SELECT array_agg(s.invoice_id) INTO v_invoice_ids FROM public.vihem_installment_schedule s WHERE s.plan_id = p_plan_id AND s.invoice_id IS NOT NULL;
  DELETE FROM public.vihem_installment_payment_allocations WHERE plan_invoice_id IN (SELECT id FROM public.vihem_installment_plan_invoices WHERE plan_id = p_plan_id);
  DELETE FROM public.vihem_installment_plans WHERE id = p_plan_id;
  IF v_invoice_ids IS NOT NULL THEN DELETE FROM public.vihem_invoices WHERE id = ANY(v_invoice_ids) AND status IN ('draft', 'cancelled'); END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.vihem_queue_installment_reminders(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vihem_queue_installment_reminders(uuid, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.vihem_generate_installment_invoice(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vihem_generate_installment_invoice(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.vihem_delete_installment_plan(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vihem_delete_installment_plan(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
