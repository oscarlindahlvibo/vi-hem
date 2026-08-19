-- Completes the installment workflow after the initial repair migrations.
-- Invoice creation is intentionally explicit and restricted to administrators.

ALTER TABLE public.vihem_installment_payments
  ADD COLUMN IF NOT EXISTS unallocated_amount numeric(14,2) NOT NULL DEFAULT 0;

UPDATE public.vihem_installment_schedule
SET email_send_date = CURRENT_DATE
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
  IF NOT FOUND THEN RAISE EXCEPTION 'Delbetalningen hittades inte.'; END IF;

  SELECT * INTO v_plan
  FROM public.vihem_installment_plans
  WHERE id = v_schedule.plan_id
  FOR UPDATE;
  IF NOT FOUND OR v_plan.organisation_id <> public.vihem_get_my_org_id() THEN
    RAISE EXCEPTION 'Avbetalningsplanen är inte tillgänglig.';
  END IF;

  IF v_schedule.invoice_id IS NOT NULL THEN
    SELECT * INTO v_invoice FROM public.vihem_invoices WHERE id = v_schedule.invoice_id;
    RETURN v_invoice;
  END IF;

  SELECT id INTO v_series_id
  FROM public.vihem_invoice_number_series
  WHERE company_id = v_plan.company_id AND active = true
  ORDER BY (name = 'Standard') DESC, created_at
  LIMIT 1;

  IF v_series_id IS NULL THEN
    INSERT INTO public.vihem_invoice_number_series (organisation_id, company_id, name, prefix, padding, active)
    VALUES (v_plan.organisation_id, v_plan.company_id, 'Standard', 'F', 4, true)
    ON CONFLICT (company_id, name) DO UPDATE SET active = true, updated_at = now()
    RETURNING id INTO v_series_id;
  END IF;

  v_invoice_number := public.vihem_next_invoice_number(v_series_id);

  INSERT INTO public.vihem_invoices (
    organisation_id, company_id, customer_id, invoice_number, invoice_date, due_date,
    payment_terms_days, currency, status, accounting_status, payment_status,
    source_type, source_id, subtotal_amount, vat_amount, total_amount, paid_amount,
    notes, created_by, approved_by, approved_at
  ) VALUES (
    v_plan.organisation_id, v_plan.company_id, v_plan.customer_id, v_invoice_number,
    CURRENT_DATE, v_schedule.due_date, GREATEST(v_schedule.due_date - CURRENT_DATE, 0),
    'SEK', 'approved', 'not_synced', 'unpaid', 'installment_plan', v_plan.id,
    v_schedule.amount, 0, v_schedule.amount, 0,
    format('Avbetalningsplan %s, del %s. Kvarstående efter denna del: %s',
      v_plan.plan_number, v_schedule.installment_no, to_char(v_plan.remaining_amount, 'FM999999990.00')),
    auth.uid(), auth.uid(), now()
  ) RETURNING * INTO v_invoice;

  INSERT INTO public.vihem_invoice_lines (
    organisation_id, company_id, invoice_id, line_no, description, quantity, unit,
    unit_price, vat_rate, line_type, line_total_excl_vat, vat_amount,
    line_total_incl_vat, metadata
  ) VALUES (
    v_plan.organisation_id, v_plan.company_id, v_invoice.id, 1,
    format('Delbetalning %s av %s', v_schedule.installment_no, v_plan.plan_number),
    1, 'st', v_schedule.amount, 0, 'fee', v_schedule.amount, 0,
    v_schedule.amount, jsonb_build_object('plan_id', v_plan.id, 'schedule_id', v_schedule.id)
  );

  UPDATE public.vihem_installment_schedule
  SET invoice_id = v_invoice.id,
      email_send_date = LEAST(COALESCE(email_send_date, CURRENT_DATE), CURRENT_DATE),
      updated_at = now()
  WHERE id = v_schedule.id;

  INSERT INTO public.vihem_installment_audit_log (organisation_id, plan_id, action, metadata, created_by)
  VALUES (v_plan.organisation_id, v_plan.id, 'invoice_created',
    jsonb_build_object('invoice_id', v_invoice.id, 'invoice_number', v_invoice_number, 'schedule_id', v_schedule.id), auth.uid());

  RETURN v_invoice;
END;
$$;

REVOKE ALL ON FUNCTION public.vihem_generate_installment_invoice(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vihem_generate_installment_invoice(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
