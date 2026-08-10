/*
  # Real OCR scanner foundation

  Extends the existing supplier invoice OCR flow instead of creating a
  parallel scanner. Receipts use the same document, supplier invoice and line
  tables but are identified by document_kind.
*/

ALTER TABLE public.vihem_supplier_invoices
  ADD COLUMN IF NOT EXISTS document_kind text NOT NULL DEFAULT 'supplier_invoice',
  ADD COLUMN IF NOT EXISTS extracted_text text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ocr_provider text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ai_model text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ai_call_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS input_tokens integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_tokens integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ocr_pages integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_cost_sek numeric(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processing_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS validation_results jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS confidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS final_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS duplicate_supplier_invoice_id uuid REFERENCES public.vihem_supplier_invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.vihem_customer_projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS work_order_id uuid REFERENCES public.vihem_work_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES public.vihem_properties(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vehicle_id uuid,
  ADD COLUMN IF NOT EXISTS cost_center text NOT NULL DEFAULT '';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vihem_supplier_invoices_ocr_status_check'
      AND conrelid = 'public.vihem_supplier_invoices'::regclass
  ) THEN
    ALTER TABLE public.vihem_supplier_invoices DROP CONSTRAINT vihem_supplier_invoices_ocr_status_check;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vihem_supplier_invoices_document_kind_check'
      AND conrelid = 'public.vihem_supplier_invoices'::regclass
  ) THEN
    ALTER TABLE public.vihem_supplier_invoices DROP CONSTRAINT vihem_supplier_invoices_document_kind_check;
  END IF;

  ALTER TABLE public.vihem_supplier_invoices
    ADD CONSTRAINT vihem_supplier_invoices_ocr_status_check
    CHECK (ocr_status IN (
      'not_started',
      'uploaded',
      'queued',
      'extracting_text',
      'ocr_processing',
      'ai_processing',
      'validating',
      'processed',
      'needs_review',
      'completed',
      'failed'
    ));

  ALTER TABLE public.vihem_supplier_invoices
    ADD CONSTRAINT vihem_supplier_invoices_document_kind_check
    CHECK (document_kind IN ('supplier_invoice', 'receipt'));
END $$;

CREATE INDEX IF NOT EXISTS vihem_supplier_invoices_ocr_queue_idx
  ON public.vihem_supplier_invoices (organisation_id, ocr_status, created_at)
  WHERE document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS vihem_supplier_invoices_duplicate_lookup_idx
  ON public.vihem_supplier_invoices (company_id, supplier_id, supplier_invoice_number, invoice_date)
  WHERE supplier_invoice_number <> '';

CREATE TABLE IF NOT EXISTS public.vihem_supplier_accounting_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.vihem_companies(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.vihem_finance_suppliers(id) ON DELETE CASCADE,
  supplier_name_pattern text NOT NULL DEFAULT '',
  document_kind text NOT NULL DEFAULT 'supplier_invoice'
    CHECK (document_kind IN ('supplier_invoice', 'receipt', 'both')),
  account_code text NOT NULL DEFAULT '',
  vat_code text NOT NULL DEFAULT '',
  project_id uuid REFERENCES public.vihem_customer_projects(id) ON DELETE SET NULL,
  work_order_id uuid REFERENCES public.vihem_work_orders(id) ON DELETE SET NULL,
  property_id uuid REFERENCES public.vihem_properties(id) ON DELETE SET NULL,
  cost_center text NOT NULL DEFAULT '',
  confidence_boost numeric(5,2) NOT NULL DEFAULT 0.15,
  usage_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vihem_supplier_accounting_rules_lookup_idx
  ON public.vihem_supplier_accounting_rules (organisation_id, company_id, supplier_id, active);

CREATE TABLE IF NOT EXISTS public.vihem_ocr_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.vihem_companies(id) ON DELETE SET NULL,
  supplier_invoice_id uuid REFERENCES public.vihem_supplier_invoices(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.vihem_documents(id) ON DELETE SET NULL,
  document_kind text NOT NULL DEFAULT 'supplier_invoice',
  ocr_provider text NOT NULL DEFAULT '',
  ai_model text NOT NULL DEFAULT '',
  extraction_method text NOT NULL DEFAULT '',
  ai_call_count integer NOT NULL DEFAULT 0,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  ocr_pages integer NOT NULL DEFAULT 0,
  vision_fallback_used boolean NOT NULL DEFAULT false,
  estimated_cost_sek numeric(12,4) NOT NULL DEFAULT 0,
  processing_ms integer NOT NULL DEFAULT 0,
  retries integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed', 'needs_review')),
  error_message text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vihem_ocr_usage_logs_month_idx
  ON public.vihem_ocr_usage_logs (organisation_id, created_at DESC);

ALTER TABLE public.vihem_supplier_accounting_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_ocr_usage_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM OCR rules read" ON public.vihem_supplier_accounting_rules;
CREATE POLICY "VIHEM OCR rules read"
  ON public.vihem_supplier_accounting_rules FOR SELECT TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_user_has_company_access(company_id, 'viewer')
    )
  );

DROP POLICY IF EXISTS "VIHEM OCR rules write" ON public.vihem_supplier_accounting_rules;
CREATE POLICY "VIHEM OCR rules write"
  ON public.vihem_supplier_accounting_rules FOR ALL TO authenticated
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

DROP POLICY IF EXISTS "VIHEM OCR usage read" ON public.vihem_ocr_usage_logs;
CREATE POLICY "VIHEM OCR usage read"
  ON public.vihem_ocr_usage_logs FOR SELECT TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND (company_id IS NULL OR public.vihem_user_has_company_access(company_id, 'viewer'))
    )
  );

DROP POLICY IF EXISTS "VIHEM OCR usage service insert" ON public.vihem_ocr_usage_logs;
CREATE POLICY "VIHEM OCR usage service insert"
  ON public.vihem_ocr_usage_logs FOR INSERT TO authenticated
  WITH CHECK (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND (company_id IS NULL OR public.vihem_user_has_company_access(company_id, 'bookkeeper'))
    )
  );
