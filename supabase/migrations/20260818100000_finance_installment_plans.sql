-- Installment plans are administrative collection metadata only.
-- They must never create accounting exports, journal entries, or invoices.

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

CREATE UNIQUE INDEX IF NOT EXISTS vihem_installment_plan_invoice_unique
  ON public.vihem_installment_plan_invoices(plan_id, invoice_id)
  WHERE invoice_id IS NOT NULL;

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
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, installment_no)
);

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

UPDATE public.vihem_installment_payment_allocations allocations
SET organisation_id = plans.organisation_id
FROM public.vihem_installment_payments payments
JOIN public.vihem_installment_plans plans ON plans.id = payments.plan_id
WHERE allocations.payment_id = payments.id
  AND allocations.organisation_id IS NULL;

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

CREATE INDEX IF NOT EXISTS vihem_installment_plans_org_status_idx ON public.vihem_installment_plans(organisation_id, status);
CREATE INDEX IF NOT EXISTS vihem_installment_plan_invoices_plan_idx ON public.vihem_installment_plan_invoices(plan_id);
CREATE INDEX IF NOT EXISTS vihem_installment_schedule_due_idx ON public.vihem_installment_schedule(organisation_id, due_date, status);
CREATE INDEX IF NOT EXISTS vihem_installment_payments_plan_date_idx ON public.vihem_installment_payments(plan_id, payment_date);
CREATE INDEX IF NOT EXISTS vihem_installment_audit_plan_created_idx ON public.vihem_installment_audit_log(plan_id, created_at DESC);

ALTER TABLE public.vihem_installment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_installment_plan_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_installment_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_installment_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_installment_payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_installment_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_installment_reminder_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM installment plans org access" ON public.vihem_installment_plans;
CREATE POLICY "VIHEM installment plans org access" ON public.vihem_installment_plans
  FOR ALL USING (public.vihem_get_my_role() = 'superadmin' OR organisation_id = public.vihem_get_my_org_id())
  WITH CHECK (public.vihem_get_my_role() = 'superadmin' OR organisation_id = public.vihem_get_my_org_id());

DO $$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'vihem_installment_plan_invoices',
    'vihem_installment_schedule',
    'vihem_installment_payments',
    'vihem_installment_payment_allocations',
    'vihem_installment_audit_log',
    'vihem_installment_reminder_log'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'VIHEM ' || relation_name || ' org access', relation_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (public.vihem_get_my_role() = ''superadmin'' OR organisation_id = public.vihem_get_my_org_id()) WITH CHECK (public.vihem_get_my_role() = ''superadmin'' OR organisation_id = public.vihem_get_my_org_id())',
      'VIHEM ' || relation_name || ' org access', relation_name
    );
  END LOOP;
END $$;
