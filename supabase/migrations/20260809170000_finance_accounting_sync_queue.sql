-- Shared accounting sync queue for invoices and payments.
-- Keeps provider-specific adapters outside the core finance tables while giving admin a visible retry/error trail.

CREATE TABLE IF NOT EXISTS public.vihem_accounting_sync_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.vihem_companies(id) ON DELETE CASCADE,
  integration_id uuid REFERENCES public.vihem_accounting_integrations(id) ON DELETE SET NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('invoice', 'payment', 'customer', 'supplier', 'supplier_invoice')),
  entity_id uuid NOT NULL,
  action text NOT NULL DEFAULT 'upsert' CHECK (action IN ('upsert', 'delete', 'void', 'payment')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'synced', 'failed', 'cancelled')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  external_id text NOT NULL DEFAULT '',
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  synced_at timestamptz,
  error_message text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, entity_type, entity_id, action)
);

CREATE INDEX IF NOT EXISTS vihem_accounting_sync_queue_company_status_idx
  ON public.vihem_accounting_sync_queue (company_id, status, created_at DESC);

ALTER TABLE public.vihem_accounting_sync_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM accounting sync queue read" ON public.vihem_accounting_sync_queue;
CREATE POLICY "VIHEM accounting sync queue read"
  ON public.vihem_accounting_sync_queue FOR SELECT TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_user_has_company_access(company_id, 'viewer')
    )
  );

DROP POLICY IF EXISTS "VIHEM accounting sync queue write" ON public.vihem_accounting_sync_queue;
CREATE POLICY "VIHEM accounting sync queue write"
  ON public.vihem_accounting_sync_queue FOR ALL TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_user_has_company_access(company_id, 'bookkeeper')
    )
  )
  WITH CHECK (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_user_has_company_access(company_id, 'bookkeeper')
    )
  );

DROP TRIGGER IF EXISTS vihem_touch_updated_at_trigger ON public.vihem_accounting_sync_queue;
CREATE TRIGGER vihem_touch_updated_at_trigger
  BEFORE UPDATE ON public.vihem_accounting_sync_queue
  FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at();

DROP TRIGGER IF EXISTS vihem_finance_audit_trigger ON public.vihem_accounting_sync_queue;
CREATE TRIGGER vihem_finance_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.vihem_accounting_sync_queue
  FOR EACH ROW EXECUTE FUNCTION public.vihem_finance_audit_trigger();

CREATE OR REPLACE FUNCTION public.vihem_queue_accounting_sync(
  target_company_id uuid,
  target_entity_type text,
  target_entity_id uuid,
  target_action text DEFAULT 'upsert'
)
RETURNS public.vihem_accounting_sync_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  company_record public.vihem_companies%ROWTYPE;
  integration_record public.vihem_accounting_integrations%ROWTYPE;
  entity_org uuid;
  entity_company uuid;
  queue_record public.vihem_accounting_sync_queue%ROWTYPE;
BEGIN
  IF target_entity_type NOT IN ('invoice', 'payment', 'customer', 'supplier', 'supplier_invoice') THEN
    RAISE EXCEPTION 'Ogiltig synktyp.';
  END IF;

  IF target_action NOT IN ('upsert', 'delete', 'void', 'payment') THEN
    RAISE EXCEPTION 'Ogiltig synkåtgärd.';
  END IF;

  SELECT * INTO company_record
  FROM public.vihem_companies
  WHERE id = target_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bolaget hittades inte.';
  END IF;

  IF public.vihem_get_my_role() <> 'superadmin'
    AND NOT public.vihem_user_has_company_access(target_company_id, 'bookkeeper') THEN
    RAISE EXCEPTION 'Saknar behörighet att köa bokföringssynk.';
  END IF;

  IF target_entity_type = 'invoice' THEN
    SELECT organisation_id, company_id INTO entity_org, entity_company
    FROM public.vihem_invoices
    WHERE id = target_entity_id;
  ELSIF target_entity_type = 'payment' THEN
    SELECT organisation_id, company_id INTO entity_org, entity_company
    FROM public.vihem_payments
    WHERE id = target_entity_id;
  ELSIF target_entity_type = 'customer' THEN
    SELECT organisation_id, COALESCE(company_id, target_company_id) INTO entity_org, entity_company
    FROM public.vihem_finance_customers
    WHERE id = target_entity_id;
  ELSIF target_entity_type = 'supplier' THEN
    SELECT organisation_id, COALESCE(company_id, target_company_id) INTO entity_org, entity_company
    FROM public.vihem_finance_suppliers
    WHERE id = target_entity_id;
  ELSE
    SELECT organisation_id, company_id INTO entity_org, entity_company
    FROM public.vihem_supplier_invoices
    WHERE id = target_entity_id;
  END IF;

  IF entity_org IS NULL THEN
    RAISE EXCEPTION 'Objektet som ska synkas hittades inte.';
  END IF;

  IF entity_org <> company_record.organisation_id OR entity_company <> target_company_id THEN
    RAISE EXCEPTION 'Objektet tillhör inte valt bolag.';
  END IF;

  SELECT * INTO integration_record
  FROM public.vihem_accounting_integrations
  WHERE company_id = target_company_id
    AND status = 'active'
  ORDER BY
    CASE provider
      WHEN 'fortnox' THEN 1
      WHEN 'spiris' THEN 2
      WHEN 'accounted' THEN 3
      WHEN 'sie' THEN 4
      WHEN 'manual' THEN 5
      ELSE 9
    END,
    updated_at DESC
  LIMIT 1;

  INSERT INTO public.vihem_accounting_sync_queue (
    organisation_id,
    company_id,
    integration_id,
    entity_type,
    entity_id,
    action,
    status,
    payload,
    created_by
  )
  VALUES (
    company_record.organisation_id,
    target_company_id,
    integration_record.id,
    target_entity_type,
    target_entity_id,
    target_action,
    'queued',
    jsonb_build_object('queued_at', now(), 'provider', COALESCE(integration_record.provider, 'manual')),
    auth.uid()
  )
  ON CONFLICT (company_id, entity_type, entity_id, action)
  DO UPDATE SET
    status = 'queued',
    integration_id = EXCLUDED.integration_id,
    error_message = '',
    payload = public.vihem_accounting_sync_queue.payload || EXCLUDED.payload,
    updated_at = now()
  RETURNING * INTO queue_record;

  IF target_entity_type = 'invoice' THEN
    UPDATE public.vihem_invoices
    SET accounting_status = 'pending'
    WHERE id = target_entity_id
      AND accounting_status <> 'synced';
  END IF;

  RETURN queue_record;
END;
$$;

CREATE OR REPLACE FUNCTION public.vihem_queue_invoice_accounting_sync(target_invoice_id uuid)
RETURNS public.vihem_accounting_sync_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invoice_record public.vihem_invoices%ROWTYPE;
BEGIN
  SELECT * INTO invoice_record
  FROM public.vihem_invoices
  WHERE id = target_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fakturan hittades inte.';
  END IF;

  IF invoice_record.status NOT IN ('approved', 'sent', 'partially_paid', 'paid', 'overdue', 'credited') THEN
    RAISE EXCEPTION 'Endast låsta fakturor kan köas för bokföring.';
  END IF;

  RETURN public.vihem_queue_accounting_sync(
    invoice_record.company_id,
    'invoice',
    invoice_record.id,
    CASE WHEN invoice_record.status = 'credited' THEN 'void' ELSE 'upsert' END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.vihem_queue_payment_accounting_sync(target_payment_id uuid)
RETURNS public.vihem_accounting_sync_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  payment_record public.vihem_payments%ROWTYPE;
BEGIN
  SELECT * INTO payment_record
  FROM public.vihem_payments
  WHERE id = target_payment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Betalningen hittades inte.';
  END IF;

  RETURN public.vihem_queue_accounting_sync(
    payment_record.company_id,
    'payment',
    payment_record.id,
    'payment'
  );
END;
$$;
