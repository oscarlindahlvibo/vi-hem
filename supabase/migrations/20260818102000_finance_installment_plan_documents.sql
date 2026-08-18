-- Persistent documents belonging to an installment plan or its payments.
-- These are administrative underlays/attachments and never accounting exports.
CREATE TABLE IF NOT EXISTS public.vihem_installment_plan_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.vihem_installment_plans(id) ON DELETE CASCADE,
  payment_id uuid REFERENCES public.vihem_installment_payments(id) ON DELETE SET NULL,
  document_type text NOT NULL DEFAULT 'attachment'
    CHECK (document_type IN ('payment_underlay', 'attachment')),
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

CREATE INDEX IF NOT EXISTS vihem_installment_plan_documents_plan_idx
  ON public.vihem_installment_plan_documents(plan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vihem_installment_plan_documents_payment_idx
  ON public.vihem_installment_plan_documents(payment_id);

ALTER TABLE public.vihem_installment_plan_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "VIHEM installment plan documents org access" ON public.vihem_installment_plan_documents;
CREATE POLICY "VIHEM installment plan documents org access"
  ON public.vihem_installment_plan_documents
  FOR ALL
  USING (public.vihem_get_my_role() = 'superadmin' OR organisation_id = public.vihem_get_my_org_id())
  WITH CHECK (public.vihem_get_my_role() IN ('staff', 'admin', 'superadmin') AND (public.vihem_get_my_role() = 'superadmin' OR organisation_id = public.vihem_get_my_org_id()));

COMMENT ON TABLE public.vihem_installment_plan_documents IS 'Administrative installment-plan files; never export to accounting.';
