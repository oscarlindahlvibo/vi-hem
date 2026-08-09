/*
  # VI-HEM finance phase 3

  Adds supplier invoices, supplier invoice lines and a safe conversion path
  from customer project invoice basis to finance invoices.
*/

CREATE TABLE IF NOT EXISTS public.vihem_supplier_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.vihem_companies(id) ON DELETE RESTRICT,
  supplier_id uuid REFERENCES public.vihem_finance_suppliers(id) ON DELETE SET NULL,
  supplier_invoice_number text NOT NULL DEFAULT '',
  invoice_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date NOT NULL DEFAULT (CURRENT_DATE + 30),
  currency text NOT NULL DEFAULT 'SEK',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'needs_review', 'approved', 'scheduled_for_payment', 'paid', 'rejected', 'archived')),
  approval_status text NOT NULL DEFAULT 'not_started'
    CHECK (approval_status IN ('not_started', 'pending', 'approved', 'rejected')),
  payment_status text NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'scheduled', 'paid')),
  subtotal_amount numeric(14,2) NOT NULL DEFAULT 0,
  vat_amount numeric(14,2) NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  ocr_status text NOT NULL DEFAULT 'not_started'
    CHECK (ocr_status IN ('not_started', 'queued', 'processed', 'needs_review', 'failed')),
  ocr_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  document_id uuid REFERENCES public.vihem_documents(id) ON DELETE SET NULL,
  assigned_approver_id uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  rejected_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  rejected_at timestamptz,
  rejection_reason text NOT NULL DEFAULT '',
  external_accounting_id text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX IF NOT EXISTS vihem_supplier_invoices_org_idx ON public.vihem_supplier_invoices (organisation_id);
CREATE INDEX IF NOT EXISTS vihem_supplier_invoices_company_status_idx ON public.vihem_supplier_invoices (company_id, status);
CREATE INDEX IF NOT EXISTS vihem_supplier_invoices_due_idx ON public.vihem_supplier_invoices (organisation_id, due_date);

CREATE TABLE IF NOT EXISTS public.vihem_supplier_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.vihem_companies(id) ON DELETE RESTRICT,
  supplier_invoice_id uuid NOT NULL REFERENCES public.vihem_supplier_invoices(id) ON DELETE CASCADE,
  line_no integer NOT NULL DEFAULT 1,
  description text NOT NULL DEFAULT '',
  quantity numeric(14,4) NOT NULL DEFAULT 1,
  unit text NOT NULL DEFAULT 'st',
  unit_price numeric(14,2) NOT NULL DEFAULT 0,
  vat_rate numeric(6,2) NOT NULL DEFAULT 25,
  account_code text NOT NULL DEFAULT '',
  project_id uuid REFERENCES public.vihem_customer_projects(id) ON DELETE SET NULL,
  work_order_id uuid REFERENCES public.vihem_work_orders(id) ON DELETE SET NULL,
  line_total_excl_vat numeric(14,2) NOT NULL DEFAULT 0,
  vat_amount numeric(14,2) NOT NULL DEFAULT 0,
  line_total_incl_vat numeric(14,2) NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vihem_supplier_invoice_lines_invoice_idx
  ON public.vihem_supplier_invoice_lines (supplier_invoice_id, line_no);

ALTER TABLE public.vihem_project_invoice_basis
  ADD COLUMN IF NOT EXISTS finance_invoice_id uuid REFERENCES public.vihem_invoices(id) ON DELETE SET NULL;

ALTER TABLE public.vihem_supplier_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_supplier_invoice_lines ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.vihem_recalculate_supplier_invoice_totals(target_supplier_invoice_id uuid)
RETURNS public.vihem_supplier_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_invoice public.vihem_supplier_invoices%ROWTYPE;
BEGIN
  UPDATE public.vihem_supplier_invoices i
  SET
    subtotal_amount = COALESCE(lines.subtotal, 0),
    vat_amount = COALESCE(lines.vat, 0),
    total_amount = COALESCE(lines.total, 0),
    updated_at = now()
  FROM (
    SELECT
      supplier_invoice_id,
      SUM(line_total_excl_vat) AS subtotal,
      SUM(vat_amount) AS vat,
      SUM(line_total_incl_vat) AS total
    FROM public.vihem_supplier_invoice_lines
    WHERE supplier_invoice_id = target_supplier_invoice_id
    GROUP BY supplier_invoice_id
  ) lines
  WHERE i.id = target_supplier_invoice_id
    AND i.id = lines.supplier_invoice_id
  RETURNING i.* INTO updated_invoice;

  IF updated_invoice.id IS NULL THEN
    UPDATE public.vihem_supplier_invoices
    SET
      subtotal_amount = 0,
      vat_amount = 0,
      total_amount = 0,
      updated_at = now()
    WHERE id = target_supplier_invoice_id
    RETURNING * INTO updated_invoice;
  END IF;

  RETURN updated_invoice;
END;
$$;

CREATE OR REPLACE FUNCTION public.vihem_supplier_invoice_lines_recalculate_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.vihem_recalculate_supplier_invoice_totals(COALESCE(NEW.supplier_invoice_id, OLD.supplier_invoice_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS vihem_supplier_invoice_lines_recalculate_trigger ON public.vihem_supplier_invoice_lines;
CREATE TRIGGER vihem_supplier_invoice_lines_recalculate_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.vihem_supplier_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public.vihem_supplier_invoice_lines_recalculate_trigger();

CREATE OR REPLACE FUNCTION public.vihem_approve_supplier_invoice(target_supplier_invoice_id uuid)
RETURNS public.vihem_supplier_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invoice_row public.vihem_supplier_invoices%ROWTYPE;
BEGIN
  SELECT *
  INTO invoice_row
  FROM public.vihem_supplier_invoices
  WHERE id = target_supplier_invoice_id
  FOR UPDATE;

  IF invoice_row.id IS NULL THEN
    RAISE EXCEPTION 'Supplier invoice not found';
  END IF;

  IF NOT public.vihem_user_has_company_access(invoice_row.company_id, 'approver') THEN
    RAISE EXCEPTION 'Not allowed to approve supplier invoice';
  END IF;

  IF invoice_row.total_amount <= 0 THEN
    RAISE EXCEPTION 'Supplier invoice total must be greater than zero';
  END IF;

  UPDATE public.vihem_supplier_invoices
  SET
    status = 'approved',
    approval_status = 'approved',
    approved_by = auth.uid(),
    approved_at = now(),
    updated_at = now()
  WHERE id = target_supplier_invoice_id
  RETURNING * INTO invoice_row;

  RETURN invoice_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.vihem_create_invoice_from_project_basis(
  target_basis_id uuid,
  target_company_id uuid,
  target_customer_id uuid,
  invoice_date date DEFAULT CURRENT_DATE,
  due_date date DEFAULT NULL
)
RETURNS public.vihem_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  basis_row public.vihem_project_invoice_basis%ROWTYPE;
  project_row public.vihem_customer_projects%ROWTYPE;
  customer_row public.vihem_finance_customers%ROWTYPE;
  invoice_row public.vihem_invoices%ROWTYPE;
  calculated_due date;
BEGIN
  SELECT *
  INTO basis_row
  FROM public.vihem_project_invoice_basis
  WHERE id = target_basis_id
  FOR UPDATE;

  IF basis_row.id IS NULL THEN
    RAISE EXCEPTION 'Project invoice basis not found';
  END IF;

  IF basis_row.status = 'invoiced' OR basis_row.finance_invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'Project invoice basis has already been invoiced';
  END IF;

  SELECT *
  INTO project_row
  FROM public.vihem_customer_projects
  WHERE id = basis_row.project_id;

  IF project_row.id IS NULL THEN
    RAISE EXCEPTION 'Project not found';
  END IF;

  SELECT *
  INTO customer_row
  FROM public.vihem_finance_customers
  WHERE id = target_customer_id
    AND organisation_id = project_row.organisation_id;

  IF customer_row.id IS NULL THEN
    RAISE EXCEPTION 'Finance customer not found';
  END IF;

  IF NOT public.vihem_user_has_company_access(target_company_id, 'seller') THEN
    RAISE EXCEPTION 'Not allowed to create invoice';
  END IF;

  calculated_due := COALESCE(due_date, invoice_date + customer_row.payment_terms_days);

  INSERT INTO public.vihem_invoices (
    organisation_id,
    company_id,
    customer_id,
    invoice_date,
    due_date,
    payment_terms_days,
    status,
    source_type,
    source_id,
    project_id,
    subtotal_amount,
    vat_amount,
    total_amount,
    notes,
    created_by
  )
  VALUES (
    project_row.organisation_id,
    target_company_id,
    target_customer_id,
    invoice_date,
    calculated_due,
    customer_row.payment_terms_days,
    'draft',
    'project_invoice_basis',
    basis_row.id,
    project_row.id,
    basis_row.total_amount,
    basis_row.vat_amount,
    basis_row.total_amount + basis_row.vat_amount,
    basis_row.description,
    auth.uid()
  )
  RETURNING * INTO invoice_row;

  INSERT INTO public.vihem_invoice_lines (
    organisation_id,
    company_id,
    invoice_id,
    line_no,
    description,
    quantity,
    unit,
    unit_price,
    vat_rate,
    line_type,
    project_id,
    line_total_excl_vat,
    vat_amount,
    line_total_incl_vat,
    metadata
  )
  SELECT
    project_row.organisation_id,
    target_company_id,
    invoice_row.id,
    row_number() OVER (ORDER BY pibl.created_at, pibl.id),
    pibl.description,
    pibl.quantity,
    pibl.unit,
    pibl.unit_price,
    pibl.vat_rate,
    CASE pibl.source_type
      WHEN 'time' THEN 'time'
      WHEN 'material' THEN 'material'
      WHEN 'change_order' THEN 'fee'
      ELSE 'manual'
    END,
    project_row.id,
    round((pibl.quantity * pibl.unit_price)::numeric, 2),
    round((pibl.quantity * pibl.unit_price * pibl.vat_rate / 100)::numeric, 2),
    round((pibl.quantity * pibl.unit_price * (1 + pibl.vat_rate / 100))::numeric, 2),
    jsonb_build_object('project_invoice_basis_line_id', pibl.id, 'source_type', pibl.source_type, 'source_id', pibl.source_id)
  FROM public.vihem_project_invoice_basis_lines pibl
  WHERE pibl.basis_id = basis_row.id
    AND pibl.billing_status = 'ready';

  PERFORM public.vihem_recalculate_invoice_totals(invoice_row.id);

  UPDATE public.vihem_project_invoice_basis
  SET
    status = 'invoiced',
    finance_invoice_id = invoice_row.id,
    updated_at = now()
  WHERE id = basis_row.id;

  UPDATE public.vihem_project_invoice_basis_lines
  SET billing_status = 'invoiced'
  WHERE basis_id = basis_row.id
    AND billing_status = 'ready';

  SELECT *
  INTO invoice_row
  FROM public.vihem_invoices
  WHERE id = invoice_row.id;

  RETURN invoice_row;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'vihem_supplier_invoices',
    'vihem_supplier_invoice_lines'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS vihem_touch_updated_at_trigger ON public.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER vihem_touch_updated_at_trigger BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at()',
      table_name
    );

    EXECUTE format('DROP TRIGGER IF EXISTS vihem_finance_audit_trigger ON public.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER vihem_finance_audit_trigger AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.vihem_finance_audit_trigger()',
      table_name
    );
  END LOOP;
END $$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'vihem_supplier_invoices',
    'vihem_supplier_invoice_lines'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "VIHEM finance supplier scoped read" ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY "VIHEM finance supplier scoped read" ON public.%I FOR SELECT TO authenticated USING (public.vihem_get_my_role() = ''superadmin'' OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_user_has_company_access(company_id, ''viewer'')))',
      table_name
    );

    EXECUTE format('DROP POLICY IF EXISTS "VIHEM finance supplier scoped insert" ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY "VIHEM finance supplier scoped insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.vihem_get_my_role() = ''superadmin'' OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_user_has_company_access(company_id, ''bookkeeper'')))',
      table_name
    );

    EXECUTE format('DROP POLICY IF EXISTS "VIHEM finance supplier scoped update" ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY "VIHEM finance supplier scoped update" ON public.%I FOR UPDATE TO authenticated USING (public.vihem_get_my_role() = ''superadmin'' OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_user_has_company_access(company_id, ''bookkeeper''))) WITH CHECK (public.vihem_get_my_role() = ''superadmin'' OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_user_has_company_access(company_id, ''bookkeeper'')))',
      table_name
    );

    EXECUTE format('DROP POLICY IF EXISTS "VIHEM finance supplier scoped delete" ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY "VIHEM finance supplier scoped delete" ON public.%I FOR DELETE TO authenticated USING (public.vihem_get_my_role() = ''superadmin'' OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_user_has_company_access(company_id, ''admin'')))',
      table_name
    );
  END LOOP;
END $$;
