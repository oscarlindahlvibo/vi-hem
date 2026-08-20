-- Final repair for the installment workflow.
-- This migration is intentionally self-contained because older deployments may
-- have recorded an earlier migration without refreshing every schema object.

ALTER TABLE public.vihem_installment_plans
  ADD COLUMN IF NOT EXISTS email_lead_days integer NOT NULL DEFAULT 30;

ALTER TABLE public.vihem_installment_payments
  ADD COLUMN IF NOT EXISTS unallocated_amount numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.vihem_installment_schedule
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.vihem_invoices(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS email_send_date date,
  ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_error text;

CREATE INDEX IF NOT EXISTS vihem_installment_schedule_invoice_idx
  ON public.vihem_installment_schedule(invoice_id);

CREATE INDEX IF NOT EXISTS vihem_installment_schedule_email_queue_idx
  ON public.vihem_installment_schedule(email_status, email_send_date);

UPDATE public.vihem_installment_schedule s
SET email_send_date = CASE
  WHEN s.due_date <= CURRENT_DATE THEN CURRENT_DATE
  ELSE s.due_date - GREATEST(COALESCE(p.email_lead_days, 30), 0)
END,
updated_at = now()
FROM public.vihem_installment_plans p
WHERE p.id = s.plan_id
  AND s.email_send_date IS NULL;

UPDATE public.vihem_installment_schedule
SET email_send_date = CURRENT_DATE,
    updated_at = now()
WHERE email_status IN ('pending', 'failed')
  AND due_date <= CURRENT_DATE
  AND (email_send_date IS NULL OR email_send_date > CURRENT_DATE);

CREATE OR REPLACE FUNCTION public.vihem_generate_installment_invoice(p_schedule_id uuid)
RETURNS public.vihem_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schedule public.vihem_installment_schedule;
  v_plan public.vihem_installment_plans;
  v_invoice public.vihem_invoices;
  v_series_id uuid;
  v_invoice_number text;
BEGIN
  IF NOT public.vihem_is_admin() THEN
    RAISE EXCEPTION 'Endast administratörer får skapa fakturor.';
  END IF;

  SELECT * INTO v_schedule
  FROM public.vihem_installment_schedule
  WHERE id = p_schedule_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delbetalningen hittades inte.';
  END IF;

  SELECT * INTO v_plan
  FROM public.vihem_installment_plans
  WHERE id = v_schedule.plan_id
  FOR UPDATE;
  IF NOT FOUND OR v_plan.organisation_id <> public.vihem_get_my_org_id() THEN
    RAISE EXCEPTION 'Avbetalningsplanen är inte tillgänglig.';
  END IF;

  IF v_schedule.invoice_id IS NOT NULL THEN
    SELECT * INTO v_invoice
    FROM public.vihem_invoices
    WHERE id = v_schedule.invoice_id;
    IF FOUND THEN
      RETURN v_invoice;
    END IF;
  END IF;

  SELECT id INTO v_series_id
  FROM public.vihem_invoice_number_series
  WHERE company_id = v_plan.company_id
    AND organisation_id = v_plan.organisation_id
    AND active = true
  ORDER BY (name = 'Standard') DESC, created_at
  LIMIT 1;

  IF v_series_id IS NULL THEN
    INSERT INTO public.vihem_invoice_number_series (
      organisation_id, company_id, name, prefix, padding, active
    ) VALUES (
      v_plan.organisation_id, v_plan.company_id, 'Standard', 'F', 4, true
    )
    ON CONFLICT (company_id, name) DO UPDATE
      SET active = true, updated_at = now()
    RETURNING id INTO v_series_id;
  END IF;

  v_invoice_number := public.vihem_next_invoice_number(v_series_id);

  INSERT INTO public.vihem_invoices (
    organisation_id, company_id, customer_id, invoice_number,
    invoice_date, due_date, payment_terms_days, currency, status,
    accounting_status, payment_status, source_type, source_id,
    subtotal_amount, vat_amount, total_amount, paid_amount, notes,
    created_by, approved_by, approved_at
  ) VALUES (
    v_plan.organisation_id, v_plan.company_id, v_plan.customer_id,
    v_invoice_number, CURRENT_DATE, v_schedule.due_date,
    GREATEST(v_schedule.due_date - CURRENT_DATE, 0), 'SEK', 'approved',
    'not_synced', 'unpaid', 'installment_plan', v_plan.id,
    v_schedule.amount, 0, v_schedule.amount, 0,
    format(
      'Avbetalningsplan %s, del %s. Kvarstående efter denna del: %s',
      v_plan.plan_number, v_schedule.installment_no,
      to_char(GREATEST(v_plan.remaining_amount - v_schedule.amount, 0), 'FM999999990.00')
    ),
    auth.uid(), auth.uid(), now()
  )
  RETURNING * INTO v_invoice;

  INSERT INTO public.vihem_invoice_lines (
    organisation_id, company_id, invoice_id, line_no, description,
    quantity, unit, unit_price, vat_rate, line_type,
    line_total_excl_vat, vat_amount, line_total_incl_vat, metadata
  ) VALUES (
    v_plan.organisation_id, v_plan.company_id, v_invoice.id, 1,
    format('Delbetalning %s av %s', v_schedule.installment_no, v_plan.plan_number),
    1, 'st', v_schedule.amount, 0, 'fee',
    v_schedule.amount, 0, v_schedule.amount,
    jsonb_build_object(
      'plan_id', v_plan.id,
      'schedule_id', v_schedule.id,
      'remaining_amount', GREATEST(v_plan.remaining_amount - v_schedule.amount, 0)
    )
  );

  UPDATE public.vihem_installment_schedule
  SET invoice_id = v_invoice.id,
      email_send_date = CASE
        WHEN due_date <= CURRENT_DATE THEN CURRENT_DATE
        ELSE COALESCE(email_send_date, due_date - GREATEST(v_plan.email_lead_days, 0))
      END,
      updated_at = now()
  WHERE id = v_schedule.id;

  INSERT INTO public.vihem_installment_audit_log (
    organisation_id, plan_id, action, metadata, created_by
  ) VALUES (
    v_plan.organisation_id, v_plan.id, 'invoice_created',
    jsonb_build_object(
      'invoice_id', v_invoice.id,
      'invoice_number', v_invoice_number,
      'schedule_id', v_schedule.id,
      'status', 'approved'
    ), auth.uid()
  );

  RETURN v_invoice;
END;
$$;

REVOKE ALL ON FUNCTION public.vihem_generate_installment_invoice(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vihem_generate_installment_invoice(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.vihem_delete_installment_plan(p_plan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_invoice_ids uuid[];
BEGIN
  IF NOT public.vihem_is_admin() THEN
    RAISE EXCEPTION 'Endast administratörer får radera avbetalningsplaner.';
  END IF;

  SELECT organisation_id INTO v_org
  FROM public.vihem_installment_plans
  WHERE id = p_plan_id;
  IF v_org IS NULL OR v_org <> public.vihem_get_my_org_id() THEN
    RAISE EXCEPTION 'Avbetalningsplanen är inte tillgänglig.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.vihem_invoices i
    JOIN public.vihem_installment_schedule s ON s.invoice_id = i.id
    WHERE s.plan_id = p_plan_id
      AND i.status NOT IN ('draft', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'Avbetalningsplanen kan inte raderas eftersom en genererad faktura redan är skickad eller bokförd.';
  END IF;

  SELECT array_agg(s.invoice_id) INTO v_invoice_ids
  FROM public.vihem_installment_schedule s
  WHERE s.plan_id = p_plan_id AND s.invoice_id IS NOT NULL;

  DELETE FROM public.vihem_installment_payment_allocations
  WHERE plan_invoice_id IN (
    SELECT id FROM public.vihem_installment_plan_invoices WHERE plan_id = p_plan_id
  );

  DELETE FROM public.vihem_installment_plans WHERE id = p_plan_id;

  IF v_invoice_ids IS NOT NULL THEN
    DELETE FROM public.vihem_invoices
    WHERE id = ANY(v_invoice_ids) AND status IN ('draft', 'cancelled');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.vihem_delete_installment_plan(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vihem_delete_installment_plan(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
