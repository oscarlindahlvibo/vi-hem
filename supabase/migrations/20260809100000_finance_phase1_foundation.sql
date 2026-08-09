/*
  # VI-HEM finance phase 1

  Adds the economy foundation: legal companies, company permissions,
  customers, suppliers, invoice number series, invoices, lines, payments,
  accounting adapter configuration and audit logging.
*/

INSERT INTO public.vihem_module_registry (
  module_key,
  name,
  description,
  category,
  default_enabled,
  default_limits,
  default_settings,
  sort_order
)
VALUES (
  'finance',
  'Ekonomi',
  'Bolag, kunder, leverantörer, fakturor, betalningar och bokföringskopplingar.',
  'finance',
  false,
  '{"max_companies": 10, "max_invoices_per_month": 1000}'::jsonb,
  '{}'::jsonb,
  90
)
ON CONFLICT (module_key) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  default_limits = EXCLUDED.default_limits,
  updated_at = now();

CREATE TABLE IF NOT EXISTS public.vihem_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  name text NOT NULL,
  legal_name text NOT NULL DEFAULT '',
  organisation_number text NOT NULL DEFAULT '',
  vat_number text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  address_line1 text NOT NULL DEFAULT '',
  address_line2 text NOT NULL DEFAULT '',
  postal_code text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  country_code text NOT NULL DEFAULT 'SE',
  logo_url text NOT NULL DEFAULT '',
  bankgiro text NOT NULL DEFAULT '',
  plusgiro text NOT NULL DEFAULT '',
  iban text NOT NULL DEFAULT '',
  bic text NOT NULL DEFAULT '',
  swish_number text NOT NULL DEFAULT '',
  default_payment_terms_days integer NOT NULL DEFAULT 30 CHECK (default_payment_terms_days >= 0),
  default_currency text NOT NULL DEFAULT 'SEK',
  default_vat_rate numeric(6,2) NOT NULL DEFAULT 25 CHECK (default_vat_rate >= 0),
  invoice_prefix text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  accounting_provider text NOT NULL DEFAULT 'none',
  accounting_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS vihem_companies_org_number_unique
  ON public.vihem_companies (organisation_id, organisation_number)
  WHERE organisation_number <> '';
CREATE INDEX IF NOT EXISTS vihem_companies_org_idx ON public.vihem_companies (organisation_id);
CREATE INDEX IF NOT EXISTS vihem_companies_active_idx ON public.vihem_companies (organisation_id, active);

CREATE TABLE IF NOT EXISTS public.vihem_company_user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.vihem_companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.vihem_profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'seller', 'bookkeeper', 'approver', 'admin')),
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id)
);

CREATE INDEX IF NOT EXISTS vihem_company_user_permissions_user_idx
  ON public.vihem_company_user_permissions (user_id, active);

CREATE TABLE IF NOT EXISTS public.vihem_finance_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.vihem_companies(id) ON DELETE SET NULL,
  customer_type text NOT NULL DEFAULT 'company' CHECK (customer_type IN ('private', 'company', 'brf', 'property_owner', 'internal')),
  name text NOT NULL,
  organisation_number text NOT NULL DEFAULT '',
  vat_number text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  address_line1 text NOT NULL DEFAULT '',
  address_line2 text NOT NULL DEFAULT '',
  postal_code text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  country_code text NOT NULL DEFAULT 'SE',
  invoice_email text NOT NULL DEFAULT '',
  payment_terms_days integer NOT NULL DEFAULT 30 CHECK (payment_terms_days >= 0),
  notes text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  external_accounting_id text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vihem_finance_customers_org_idx ON public.vihem_finance_customers (organisation_id);
CREATE INDEX IF NOT EXISTS vihem_finance_customers_company_idx ON public.vihem_finance_customers (company_id);
CREATE INDEX IF NOT EXISTS vihem_finance_customers_name_idx ON public.vihem_finance_customers (organisation_id, name);

CREATE TABLE IF NOT EXISTS public.vihem_finance_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.vihem_companies(id) ON DELETE SET NULL,
  name text NOT NULL,
  organisation_number text NOT NULL DEFAULT '',
  vat_number text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  address_line1 text NOT NULL DEFAULT '',
  address_line2 text NOT NULL DEFAULT '',
  postal_code text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  country_code text NOT NULL DEFAULT 'SE',
  payment_terms_days integer NOT NULL DEFAULT 30 CHECK (payment_terms_days >= 0),
  default_account_code text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  external_accounting_id text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vihem_finance_suppliers_org_idx ON public.vihem_finance_suppliers (organisation_id);
CREATE INDEX IF NOT EXISTS vihem_finance_suppliers_company_idx ON public.vihem_finance_suppliers (company_id);

CREATE TABLE IF NOT EXISTS public.vihem_invoice_number_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.vihem_companies(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Standard',
  prefix text NOT NULL DEFAULT '',
  next_number bigint NOT NULL DEFAULT 1 CHECK (next_number > 0),
  padding integer NOT NULL DEFAULT 0 CHECK (padding >= 0),
  fiscal_year integer,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS public.vihem_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.vihem_companies(id) ON DELETE RESTRICT,
  customer_id uuid REFERENCES public.vihem_finance_customers(id) ON DELETE SET NULL,
  invoice_number text,
  invoice_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date NOT NULL DEFAULT (CURRENT_DATE + 30),
  payment_terms_days integer NOT NULL DEFAULT 30 CHECK (payment_terms_days >= 0),
  currency text NOT NULL DEFAULT 'SEK',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'sent', 'partially_paid', 'paid', 'overdue', 'credited', 'cancelled')),
  accounting_status text NOT NULL DEFAULT 'not_synced'
    CHECK (accounting_status IN ('not_synced', 'pending', 'synced', 'failed')),
  payment_status text NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'partially_paid', 'paid', 'overpaid')),
  source_type text NOT NULL DEFAULT 'manual',
  source_id uuid,
  project_id uuid REFERENCES public.vihem_customer_projects(id) ON DELETE SET NULL,
  work_order_id uuid REFERENCES public.vihem_work_orders(id) ON DELETE SET NULL,
  tenancy_id uuid REFERENCES public.vihem_tenancies(id) ON DELETE SET NULL,
  subtotal_amount numeric(14,2) NOT NULL DEFAULT 0,
  vat_amount numeric(14,2) NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  sent_at timestamptz,
  paid_at timestamptz,
  external_accounting_id text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS vihem_invoices_company_number_unique
  ON public.vihem_invoices (company_id, invoice_number)
  WHERE invoice_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS vihem_invoices_org_idx ON public.vihem_invoices (organisation_id);
CREATE INDEX IF NOT EXISTS vihem_invoices_company_status_idx ON public.vihem_invoices (company_id, status);
CREATE INDEX IF NOT EXISTS vihem_invoices_due_idx ON public.vihem_invoices (organisation_id, due_date);

CREATE TABLE IF NOT EXISTS public.vihem_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.vihem_companies(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL REFERENCES public.vihem_invoices(id) ON DELETE CASCADE,
  line_no integer NOT NULL DEFAULT 1,
  description text NOT NULL,
  quantity numeric(14,4) NOT NULL DEFAULT 1,
  unit text NOT NULL DEFAULT 'st',
  unit_price numeric(14,2) NOT NULL DEFAULT 0,
  vat_rate numeric(6,2) NOT NULL DEFAULT 25,
  account_code text NOT NULL DEFAULT '',
  line_type text NOT NULL DEFAULT 'manual'
    CHECK (line_type IN ('manual', 'rent', 'time', 'material', 'fee', 'discount', 'short_stay', 'work_order')),
  project_id uuid REFERENCES public.vihem_customer_projects(id) ON DELETE SET NULL,
  work_order_id uuid REFERENCES public.vihem_work_orders(id) ON DELETE SET NULL,
  time_entry_id uuid REFERENCES public.vihem_time_entries(id) ON DELETE SET NULL,
  line_total_excl_vat numeric(14,2) NOT NULL DEFAULT 0,
  vat_amount numeric(14,2) NOT NULL DEFAULT 0,
  line_total_incl_vat numeric(14,2) NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vihem_invoice_lines_invoice_idx ON public.vihem_invoice_lines (invoice_id, line_no);

CREATE TABLE IF NOT EXISTS public.vihem_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.vihem_companies(id) ON DELETE RESTRICT,
  invoice_id uuid REFERENCES public.vihem_invoices(id) ON DELETE SET NULL,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'SEK',
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'accounting', 'bank', 'swish', 'autogiro')),
  reference text NOT NULL DEFAULT '',
  external_payment_id text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vihem_payments_invoice_idx ON public.vihem_payments (invoice_id);
CREATE INDEX IF NOT EXISTS vihem_payments_company_date_idx ON public.vihem_payments (company_id, payment_date);

CREATE TABLE IF NOT EXISTS public.vihem_accounting_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.vihem_companies(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'none'
    CHECK (provider IN ('none', 'spiris', 'accounted', 'fortnox', 'sie', 'manual')),
  status text NOT NULL DEFAULT 'not_configured'
    CHECK (status IN ('not_configured', 'active', 'paused', 'error')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, provider)
);

CREATE TABLE IF NOT EXISTS public.vihem_finance_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.vihem_companies(id) ON DELETE SET NULL,
  table_name text NOT NULL,
  record_id uuid,
  action text NOT NULL,
  old_data jsonb,
  new_data jsonb,
  changed_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vihem_finance_audit_log_org_idx ON public.vihem_finance_audit_log (organisation_id, created_at DESC);

ALTER TABLE public.vihem_properties ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.vihem_companies(id) ON DELETE SET NULL;
ALTER TABLE public.vihem_apartments ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.vihem_companies(id) ON DELETE SET NULL;
ALTER TABLE public.vihem_tenancies ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.vihem_companies(id) ON DELETE SET NULL;
ALTER TABLE public.vihem_customer_projects ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.vihem_companies(id) ON DELETE SET NULL;
ALTER TABLE public.vihem_work_orders ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.vihem_companies(id) ON DELETE SET NULL;
ALTER TABLE public.vihem_time_entries ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.vihem_companies(id) ON DELETE SET NULL;
ALTER TABLE public.vihem_documents ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.vihem_companies(id) ON DELETE SET NULL;
ALTER TABLE public.vihem_purchase_items ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.vihem_companies(id) ON DELETE SET NULL;

INSERT INTO public.vihem_companies (
  organisation_id,
  name,
  legal_name,
  email,
  phone,
  invoice_prefix
)
SELECT
  o.id,
  o.name,
  o.name,
  COALESCE(o.contact_email, ''),
  COALESCE(o.contact_phone, ''),
  upper(left(regexp_replace(o.name, '[^a-zA-Z0-9]', '', 'g'), 4))
FROM public.vihem_organisations o
WHERE NOT EXISTS (
  SELECT 1
  FROM public.vihem_companies c
  WHERE c.organisation_id = o.id
);

INSERT INTO public.vihem_invoice_number_series (
  organisation_id,
  company_id,
  name,
  prefix,
  padding
)
SELECT
  c.organisation_id,
  c.id,
  'Standard',
  COALESCE(NULLIF(c.invoice_prefix, ''), 'F'),
  4
FROM public.vihem_companies c
WHERE NOT EXISTS (
  SELECT 1
  FROM public.vihem_invoice_number_series s
  WHERE s.company_id = c.id
);

UPDATE public.vihem_properties p
SET company_id = c.id
FROM public.vihem_companies c
WHERE p.company_id IS NULL
  AND c.organisation_id = p.organisation_id;

UPDATE public.vihem_apartments a
SET company_id = p.company_id
FROM public.vihem_properties p
WHERE a.company_id IS NULL
  AND a.property_id = p.id;

UPDATE public.vihem_tenancies t
SET company_id = p.company_id
FROM public.vihem_properties p
WHERE t.company_id IS NULL
  AND t.property_id = p.id;

UPDATE public.vihem_customer_projects cp
SET company_id = c.id
FROM public.vihem_companies c
WHERE cp.company_id IS NULL
  AND cp.organisation_id = c.organisation_id;

UPDATE public.vihem_work_orders wo
SET company_id = p.company_id
FROM public.vihem_properties p
WHERE wo.company_id IS NULL
  AND wo.property_id = p.id;

UPDATE public.vihem_work_orders wo
SET company_id = c.id
FROM public.vihem_companies c
WHERE wo.company_id IS NULL
  AND wo.organisation_id = c.organisation_id;

UPDATE public.vihem_time_entries te
SET company_id = c.id
FROM public.vihem_companies c
WHERE te.company_id IS NULL
  AND te.organisation_id = c.organisation_id;

UPDATE public.vihem_documents d
SET company_id = c.id
FROM public.vihem_companies c
WHERE d.company_id IS NULL
  AND d.organisation_id = c.organisation_id;

UPDATE public.vihem_purchase_items pi
SET company_id = c.id
FROM public.vihem_companies c
WHERE pi.company_id IS NULL
  AND pi.organisation_id = c.organisation_id;

CREATE OR REPLACE FUNCTION public.vihem_user_has_company_access(target_company_id uuid, required_role text DEFAULT 'viewer')
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH role_rank AS (
    SELECT *
    FROM (VALUES
      ('viewer', 1),
      ('seller', 2),
      ('bookkeeper', 3),
      ('approver', 4),
      ('admin', 5)
    ) AS roles(role_key, rank)
  ),
  current_required AS (
    SELECT COALESCE((SELECT rank FROM role_rank WHERE role_key = required_role), 1) AS rank
  )
  SELECT
    public.vihem_get_my_role() = 'superadmin'
    OR (target_company_id IS NULL AND public.vihem_get_my_role() = 'admin')
    OR EXISTS (
      SELECT 1
      FROM public.vihem_companies c
      WHERE c.id = target_company_id
        AND c.organisation_id = public.vihem_get_my_org_id()
        AND public.vihem_get_my_role() = 'admin'
    )
    OR EXISTS (
      SELECT 1
      FROM public.vihem_company_user_permissions cup
      JOIN role_rank rr ON rr.role_key = cup.role
      CROSS JOIN current_required cr
      WHERE cup.company_id = target_company_id
        AND cup.user_id = auth.uid()
        AND cup.active = true
        AND rr.rank >= cr.rank
    );
$$;

CREATE OR REPLACE FUNCTION public.vihem_next_invoice_number(series_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result text;
BEGIN
  UPDATE public.vihem_invoice_number_series
  SET next_number = next_number + 1,
      updated_at = now()
  WHERE id = series_id
    AND public.vihem_user_has_company_access(company_id, 'approver')
  RETURNING prefix || lpad((next_number - 1)::text, padding, '0') INTO result;

  IF result IS NULL THEN
    RAISE EXCEPTION 'Invoice number series not found or not allowed';
  END IF;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.vihem_finance_audit_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  record_data jsonb;
  old_record jsonb;
  new_record jsonb;
  audit_org uuid;
  audit_company uuid;
  audit_record uuid;
BEGIN
  old_record := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END;
  new_record := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END;
  record_data := COALESCE(new_record, old_record);
  audit_org := NULLIF(record_data->>'organisation_id', '')::uuid;
  audit_company := NULLIF(record_data->>'company_id', '')::uuid;
  audit_record := NULLIF(record_data->>'id', '')::uuid;

  INSERT INTO public.vihem_finance_audit_log (
    organisation_id,
    company_id,
    table_name,
    record_id,
    action,
    old_data,
    new_data,
    changed_by
  )
  VALUES (
    audit_org,
    audit_company,
    TG_TABLE_NAME,
    audit_record,
    lower(TG_OP),
    old_record,
    new_record,
    auth.uid()
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'vihem_companies',
    'vihem_company_user_permissions',
    'vihem_finance_customers',
    'vihem_finance_suppliers',
    'vihem_invoice_number_series',
    'vihem_invoices',
    'vihem_invoice_lines',
    'vihem_payments',
    'vihem_accounting_integrations'
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

ALTER TABLE public.vihem_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_company_user_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_finance_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_finance_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_invoice_number_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_accounting_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_finance_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM finance companies read" ON public.vihem_companies;
CREATE POLICY "VIHEM finance companies read"
  ON public.vihem_companies FOR SELECT TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR organisation_id = public.vihem_get_my_org_id()
  );

DROP POLICY IF EXISTS "VIHEM finance companies admin write" ON public.vihem_companies;
CREATE POLICY "VIHEM finance companies admin write"
  ON public.vihem_companies FOR ALL TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() = 'admin')
  )
  WITH CHECK (
    public.vihem_get_my_role() = 'superadmin'
    OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() = 'admin')
  );

DROP POLICY IF EXISTS "VIHEM finance permissions read" ON public.vihem_company_user_permissions;
CREATE POLICY "VIHEM finance permissions read"
  ON public.vihem_company_user_permissions FOR SELECT TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() = 'admin')
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "VIHEM finance permissions admin write" ON public.vihem_company_user_permissions;
CREATE POLICY "VIHEM finance permissions admin write"
  ON public.vihem_company_user_permissions FOR ALL TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() = 'admin')
  )
  WITH CHECK (
    public.vihem_get_my_role() = 'superadmin'
    OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() = 'admin')
  );

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'vihem_finance_customers',
    'vihem_finance_suppliers',
    'vihem_invoice_number_series',
    'vihem_invoices',
    'vihem_invoice_lines',
    'vihem_payments',
    'vihem_accounting_integrations'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "VIHEM finance scoped read" ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY "VIHEM finance scoped read" ON public.%I FOR SELECT TO authenticated USING (public.vihem_get_my_role() = ''superadmin'' OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_user_has_company_access(company_id, ''viewer'')))',
      table_name
    );

    EXECUTE format('DROP POLICY IF EXISTS "VIHEM finance scoped insert" ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY "VIHEM finance scoped insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.vihem_get_my_role() = ''superadmin'' OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_user_has_company_access(company_id, ''seller'')))',
      table_name
    );

    EXECUTE format('DROP POLICY IF EXISTS "VIHEM finance scoped update" ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY "VIHEM finance scoped update" ON public.%I FOR UPDATE TO authenticated USING (public.vihem_get_my_role() = ''superadmin'' OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_user_has_company_access(company_id, ''seller''))) WITH CHECK (public.vihem_get_my_role() = ''superadmin'' OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_user_has_company_access(company_id, ''seller'')))',
      table_name
    );

    EXECUTE format('DROP POLICY IF EXISTS "VIHEM finance scoped delete" ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY "VIHEM finance scoped delete" ON public.%I FOR DELETE TO authenticated USING (public.vihem_get_my_role() = ''superadmin'' OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_user_has_company_access(company_id, ''admin'')))',
      table_name
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS "VIHEM finance audit read" ON public.vihem_finance_audit_log;
CREATE POLICY "VIHEM finance audit read"
  ON public.vihem_finance_audit_log FOR SELECT TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_get_my_role() = 'admin'
    )
  );
